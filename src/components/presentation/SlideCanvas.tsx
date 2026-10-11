import {
  chartPrimitives,
  framedImagePlacement,
  layoutSlide,
  tablePrimitives,
} from "../../lib/presentation/layout";
import type { SlideElement } from "../../lib/presentation/layout";
import type {
  Audience,
  Presentation,
  SlideSpec,
} from "../../lib/presentation/contracts";

function Element({ element, id }: { element: SlideElement; id: string }) {
  if (element.kind === "rect")
    return (
      <rect
        x={element.x}
        y={element.y}
        width={element.w}
        height={element.h}
        fill={`#${element.color}`}
        opacity={element.opacity ?? 1}
      />
    );
  if (element.kind === "image") {
    const frame = framedImagePlacement(element);
    return (
      <svg
        x={element.x}
        y={element.y}
        width={element.w}
        height={element.h}
        viewBox={`0 0 ${element.w} ${element.h}`}
        overflow="hidden"
      >
        <image
          href={element.url}
          x={frame?.x ?? 0}
          y={frame?.y ?? 0}
          width={frame?.w ?? element.w}
          height={frame?.h ?? element.h}
          preserveAspectRatio={
            frame
              ? "none"
              : element.fit === "cover"
                ? `${element.align === "right" ? "xMax" : element.align === "left" ? "xMin" : "xMid"}YMid slice`
                : "xMidYMid meet"
          }
        />
      </svg>
    );
  }
  if (element.kind === "chart" || element.kind === "table") {
    const primitives =
      element.kind === "chart"
        ? chartPrimitives(element)
        : tablePrimitives(element);
    return (
      <g>
        {primitives.map((e, i) => (
          <Element key={i} element={e} id={`${id}-${i}`} />
        ))}
      </g>
    );
  }
  return (
    <text
      transform={
        element.rotation
          ? `rotate(${element.rotation} ${element.x} ${element.y})`
          : undefined
      }
      x={element.x}
      y={element.y + element.size}
      fontFamily="Arial, sans-serif"
      fontSize={element.size}
      fontWeight={element.bold ? 700 : 400}
      fill={`#${element.color}`}
    >
      {element.lines.map((line, i) => (
        <tspan key={i} x={element.x} dy={i ? element.size * 1.24 : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function SlideCanvas({
  presentation,
  slide,
  index,
  audience,
}: {
  presentation: Presentation;
  slide: SlideSpec;
  index: number;
  audience: Audience;
}) {
  const layout = layoutSlide(presentation, slide, index, audience);
  return (
    <svg
      className="slide-canvas"
      viewBox="0 0 960 540"
      role="img"
      aria-label={`Slide ${index + 1}: ${slide.title}`}
    >
      <title>{slide.title}</title>
      <rect width="960" height="540" fill={`#${layout.background}`} />
      {layout.elements.map((element, i) => (
        <Element key={i} element={element} id={`${slide.id}-${i}`} />
      ))}
    </svg>
  );
}
