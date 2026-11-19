import { templates } from "./templates.js";
const FONT = '"Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei", sans-serif';

// Version 1: existing templates keep their document geometry and fonts.
const sizeFor = (ratio) =>
  ({
    "3:4": [600, 800],
    "1:1": [600, 600],
    "16:9": [960, 540],
    "9:16": [540, 960],
  })[ratio] || [600, 800];
export const initialDesign = (project) => {
  const [width, height] = sizeFor(project?.ratio);
  if (project?.design)
    return {
      ...project.design,
      width: project.design.width || width,
      height: project.design.height || height,
    };
  if (project?.blank)
    return {
      width,
      height,
      background: project.background || "#ffffff",
      nodes: [],
    };
  const match =
    templates.find((t) => t.theme === project?.theme) ||
    templates.find((t) => t.image === project?.image) ||
    templates[0];
  const theme = { ...match, ...project },
    themeName = theme.theme || match.theme;
  const light = ["nature", "coffee", "interior", "audio"].includes(themeName),
    ink = light ? "#ffffff" : "#323a2e";
  const fullBleed = ["nature", "coffee", "interior", "audio"].includes(
    themeName,
  );
  const titleText = theme.en || match.en,
    lines = titleText.split("\n").length;
  const size =
    themeName === "brand"
      ? 104
      : themeName === "editorial"
        ? 84
        : themeName === "coffee"
          ? 94
          : themeName === "audio"
            ? 72
            : 80;
  const sx = width / 600,
    sy = height / 800;
  const nodes = [
    {
      id: "photo",
      type: "image",
      label: theme.subtitle || theme.title || "主视觉",
      src: theme.image || "/assets/coffee.jpg",
      x: themeName === "fashion" ? 42 : 0,
      y: fullBleed ? 0 : themeName === "fashion" ? 185 : 200,
      w: themeName === "fashion" ? 516 : 600,
      h: fullBleed ? 800 : themeName === "fashion" ? 512 : 600,
      opacity: 1,
    },
    ...(fullBleed
      ? [
          {
            id: "photo-shade",
            type: "rect",
            label: "文字衬底",
            x: 0,
            y: 0,
            w: 600,
            h: 800,
            color: "#13251c",
            opacity: themeName === "coffee" ? 0.34 : 0.18,
          },
        ]
      : []),
    {
      id: "brand",
      type: "text",
      text: theme.label || match.label,
      x: 38,
      y: 35,
      w: 530,
      h: 24,
      size: 14,
      color: ink,
      weight: 500,
      font: FONT,
    },
    {
      id: "title",
      type: "text",
      text: titleText,
      x: 35,
      y: 93,
      w: 540,
      h: lines * size * 1.15,
      size,
      color: ink,
      weight: themeName === "skin" || themeName === "interior" ? 400 : 700,
      font: ["coffee", "skin", "interior", "editorial"].includes(themeName)
        ? "Georgia, serif"
        : FONT,
    },
    {
      id: "subtitle",
      type: "text",
      text: theme.title || match.title,
      x: 38,
      y: 730,
      w: 510,
      h: 37,
      size: 25,
      color: fullBleed ? "#ffffff" : ink,
      weight: 500,
      font: FONT,
    },
  ];
  if (themeName === "coffee")
    nodes.push(
      {
        id: "badge",
        type: "circle",
        label: "品牌贴纸",
        x: 429,
        y: 342,
        w: 130,
        h: 130,
        color: "#e9e5d8",
        opacity: 1,
      },
      {
        id: "badge-text",
        type: "text",
        text: "A LITTLE\nCOFFEE\nA LOT OF JOY",
        x: 443,
        y: 374,
        w: 102,
        h: 63,
        size: 14,
        color: "#47533c",
        weight: 600,
        font: FONT,
        align: "center",
      },
    );
  return {
    width,
    height,
    background: theme.background || theme.color || "#f0e7d8",
    nodes: nodes.map((n) => ({
      ...n,
      x: n.x * sx,
      y: n.y * sy,
      w: n.w * sx,
      h: n.h * sy,
      ...(n.size ? { size: Math.round(n.size * Math.min(sx, sy)) } : {}),
    })),
  };
};
