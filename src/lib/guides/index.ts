/**
 * The room layout guides (src/pages/guides/*). One list for the guides hub, the site footer,
 * llms.txt and the social cards, so titles and descriptions never disagree.
 */
export interface Guide {
  slug: string;
  /** Short name for links ("Bedroom layout"). */
  label: string;
  /** The page's <title>. */
  title: string;
  /** The page's H1. */
  heading: string;
  /** Meta description (also used on the hub and in llms.txt). */
  description: string;
}

export const GUIDES: Guide[] = [
  {
    slug: 'bedroom-layout',
    label: 'Bedroom layout',
    title: 'Bedroom Layout Guide: Bed Sizes, Clearances & Example Plans — Room Planner',
    heading: 'Bedroom layout guide',
    description:
      'Standard mattress sizes, how much space to leave around a bed, nightstand and dresser sizes, and example bedroom floor plans you can open and edit for free.',
  },
  {
    slug: 'living-room-layout',
    label: 'Living room layout',
    title: 'Living Room Layout Guide: Sofa Spacing, Walkways & TV Distance — Room Planner',
    heading: 'Living room layout guide',
    description:
      'How far a coffee table should be from the sofa, how wide to keep walkways, TV viewing distance by screen size, rug sizes and example living room floor plans.',
  },
  {
    slug: 'studio-and-dorm-layout',
    label: 'Studio & dorm layout',
    title: 'Studio Apartment & Dorm Room Layout Guide — Room Planner',
    heading: 'Studio apartment and dorm room layout guide',
    description:
      'How to fit a bed, seating, a table and storage into one small room: compact furniture sizes, dining clearances, door choices and example studio and dorm floor plans.',
  },
  {
    slug: 'home-office-layout',
    label: 'Home office layout',
    title:
      'Home Office Layout Guide: Desk Sizes, Chair Clearance & Monitor Distance — Room Planner',
    heading: 'Home office layout guide',
    description:
      'Desk sizes, how much room a desk chair needs, monitor distance, where to put the desk relative to the window, and example home office floor plans.',
  },
];

export const guidePath = (slug: string): string => `guides/${slug}/`;

export const findGuide = (slug: string): Guide => {
  const guide = GUIDES.find((g) => g.slug === slug);
  if (!guide) throw new Error(`Unknown guide: ${slug}`);
  return guide;
};
