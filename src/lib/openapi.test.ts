import { Validator } from '@seriousme/openapi-schema-validator';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { API_EXAMPLE_PLAN, openApiSpec } from './openapi';
import { publishedPlanSchema } from './planSchema';

const SITE = 'https://room-planner.andrechek.com/';

describe('/openapi.json', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const result = await new Validator().validate(
      openApiSpec(SITE) as Parameters<Validator['validate']>[0],
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('names an operation for each REST route, and its example is a valid plan', () => {
    const spec = openApiSpec(SITE) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    const ops = Object.values(spec.paths).flatMap((p) =>
      Object.values(p).map((o) => o.operationId),
    );
    expect(ops.sort()).toEqual(['checkLayout', 'createPlanLink', 'readPlanLink']);
    const validate = new Ajv2020({ strict: false }).compile(publishedPlanSchema(SITE));
    expect(validate(API_EXAMPLE_PLAN), JSON.stringify(validate.errors)).toBe(true);
  });
});
