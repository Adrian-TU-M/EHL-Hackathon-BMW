import type { Vehicle } from "./types";

// Reference vehicles are distinct from the future-product analysis scope.
export const vehicles: Record<
  Vehicle,
  {
    series: string;
    name: string;
    line: string;
    body: string;
    image: string;
    modelId: string;
    creator: string;
    modelTitle: string;
  }
> = {
  F70: {
    series: "1",
    name: "BMW 1 Series",
    line: "Compact. Confident. Connected.",
    body: "Sport hatchback",
    image: "/images/bmw-f70.webp",
    modelId: "5e5371e856ef4496b0185704b325704a",
    creator: "payodesings14",
    modelTitle: "BMW F70 PayoDesings",
  },
  G60: {
    series: "5",
    name: "BMW 5 Series",
    line: "Business, with a new perspective.",
    body: "Executive saloon",
    image: "/images/bmw-g60.webp",
    modelId: "207fd872d28b4cafa7fefe061ae98e26",
    creator: "Nazh Design",
    modelTitle: "2023 BMW i5 M60",
  },
  G70: {
    series: "7",
    name: "BMW 7 Series",
    line: "A new dimension of presence.",
    body: "Luxury saloon",
    image: "/images/bmw-g70.webp",
    modelId: "dc7cb373178a4572a506f8d4886a5d3c",
    creator: "Merc_TV",
    modelTitle: "BMW 7 Series MK7 (G70/G73) 2022",
  },
};
