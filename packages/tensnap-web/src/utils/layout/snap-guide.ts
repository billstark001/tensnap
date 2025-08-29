import { AnyView } from "@/types/ui";
import { GuidePointSet } from "./snap";


export const findAlignmentGuides = (
  views: AnyView[], excludeId?: string,
  withChildren = false,
): GuidePointSet => {
  const guides: GuidePointSet = {
    vertical: [],
    horizontal: [],
  };

  views.forEach((view) => {
    if (view.id === excludeId) return;

    const x0 = view.left;
    const x1 = view.left + view.width / 2;
    const x2 = view.left + view.width;

    const y0 = view.top;
    const y1 = view.top + view.height / 2;
    const y2 = view.top + view.height;

    guides.vertical.push({ x: x0, y: y1 });
    guides.vertical.push({ x: x1, y: y1 });
    guides.vertical.push({ x: x2, y: y1 });

    guides.horizontal.push({ x: x1, y: y0 });
    guides.horizontal.push({ x: x1, y: y1 });
    guides.horizontal.push({ x: x1, y: y2 });

    // Recursively check container children
    if (withChildren && view.type === 'container') {
      const childGuides = findAlignmentGuides(view.views, excludeId, withChildren);
      guides.vertical.push(...childGuides.vertical
        .map(({ x, y }) => ({ x: x + view.left, y: y + view.top })));
      guides.horizontal.push(...childGuides.horizontal
        .map(({ x, y }) => ({ x: x + view.left, y: y + view.top })));
    }
  });

  return guides;
};

