import { describe, expect, it, vi } from 'vitest';
import { installTranslationGuard } from './translationGuard';
import { isTranslatedClass, languageTag } from './translation';

/**
 * Just enough of a DOM node for the guard: children in order, and the browser's behaviour of
 * throwing when the node to remove, or the one to insert before, is not a child.
 */
class FakeNode {
  parentNode: FakeNode | null = null;
  children: FakeNode[] = [];
  constructor(readonly name: string) {}
  removeChild<T>(child: T): T {
    const c = child as unknown as FakeNode;
    const i = this.children.indexOf(c);
    if (i < 0) throw new Error(`NotFoundError: removeChild: ${c.name} is not a child`);
    this.children.splice(i, 1);
    c.parentNode = null;
    return child;
  }
  insertBefore<T>(node: T, ref: FakeNode | null): T {
    const n = node as unknown as FakeNode;
    if (ref && !this.children.includes(ref)) {
      throw new Error(`NotFoundError: insertBefore: ${ref.name} is not a child`);
    }
    n.parentNode?.removeChild(n);
    const at = ref ? this.children.indexOf(ref) : this.children.length;
    this.children.splice(at, 0, n);
    n.parentNode = this;
    return node;
  }
  append(...nodes: FakeNode[]) {
    for (const n of nodes) this.insertBefore(n, null);
    return this;
  }
  get names() {
    return this.children.map((c) => c.name);
  }
}

/** A fresh prototype chain per test, so installs do not leak between them. */
const freshNodeClass = () => class extends FakeNode {};

/** What Chrome's translator does to a text node: wrap it in <font><font>translated</font></font>. */
const translate = (text: FakeNode, Node: typeof FakeNode) => {
  const parent = text.parentNode!;
  const outer = new Node('font');
  parent.insertBefore(outer, text);
  const inner = new Node('font');
  outer.append(inner);
  inner.append(text); // the original node moves inside the wrapper
  return outer;
};

describe('installTranslationGuard', () => {
  it('without the guard, React-style updates on translated text throw (the bug)', () => {
    const Node = freshNodeClass();
    const p = new Node('p');
    const a = new Node('"3 items"');
    const b = new Node('" in the room"');
    p.append(a, b);
    translate(a, Node);
    expect(() => p.removeChild(a)).toThrow(/not a child/);
    expect(() => p.insertBefore(new Node('span'), a)).toThrow(/not a child/);
  });

  it('removeChild of a node moved into a wrapper removes it from there instead', () => {
    const Node = freshNodeClass();
    const onMismatch = vi.fn();
    expect(installTranslationGuard(Node.prototype, onMismatch)).toBe(true);
    const p = new Node('p');
    const a = new Node('text');
    p.append(a, new Node('b'));
    const font = translate(a, Node);
    expect(p.removeChild(a)).toBe(a);
    expect(a.parentNode).toBeNull();
    expect(font.children[0]!.children).toEqual([]);
    expect(onMismatch).toHaveBeenCalledWith('removeChild');
  });

  it('removeChild of a node already taken out is a no-op', () => {
    const Node = freshNodeClass();
    installTranslationGuard(Node.prototype);
    const p = new Node('p');
    const orphan = new Node('orphan');
    expect(() => p.removeChild(orphan)).not.toThrow();
  });

  it('insertBefore a moved node inserts before the wrapper that now holds it', () => {
    const Node = freshNodeClass();
    const onMismatch = vi.fn();
    installTranslationGuard(Node.prototype, onMismatch);
    const p = new Node('p');
    const first = new Node('first');
    const text = new Node('text');
    p.append(first, text);
    translate(text, Node);
    const added = new Node('added');
    p.insertBefore(added, text);
    expect(p.names).toEqual(['first', 'added', 'font']);
    expect(onMismatch).toHaveBeenCalledWith('insertBefore');
  });

  it('insertBefore a node that is nowhere under this one appends', () => {
    const Node = freshNodeClass();
    installTranslationGuard(Node.prototype);
    const p = new Node('p').append(new Node('a'));
    p.insertBefore(new Node('added'), new Node('elsewhere'));
    expect(p.names).toEqual(['a', 'added']);
  });

  it('ordinary calls behave exactly as before, without a mismatch', () => {
    const Node = freshNodeClass();
    const onMismatch = vi.fn();
    installTranslationGuard(Node.prototype, onMismatch);
    const p = new Node('p');
    const a = new Node('a');
    const b = new Node('b');
    p.append(a, b);
    p.insertBefore(new Node('c'), b);
    p.removeChild(a);
    expect(p.names).toEqual(['c', 'b']);
    p.insertBefore(new Node('d'), null);
    expect(p.names).toEqual(['c', 'b', 'd']);
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it('installs once', () => {
    const Node = freshNodeClass();
    expect(installTranslationGuard(Node.prototype)).toBe(true);
    const patched = Node.prototype.removeChild;
    expect(installTranslationGuard(Node.prototype)).toBe(false);
    expect(Node.prototype.removeChild).toBe(patched);
  });
});

describe('translation detection helpers', () => {
  it.each([
    ['es', 'es'],
    ['pt-BR', 'pt-BR'],
    ['zh-Hant', 'zh-Hant'],
    ['', 'unknown'],
    [null, 'unknown'],
    ['<script>', 'unknown'],
    ['english please', 'unknown'],
  ])('languageTag(%j) is %j', (input, tag) => {
    expect(languageTag(input)).toBe(tag);
  });

  it('spots the translator class on <html>', () => {
    expect(isTranslatedClass('translated-ltr')).toBe(true);
    expect(isTranslatedClass('dark translated-rtl')).toBe(true);
    expect(isTranslatedClass('untranslated')).toBe(false);
    expect(isTranslatedClass('')).toBe(false);
  });
});
