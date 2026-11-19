// Public entry points describe actual operations, not the names in the prompt library.
export function creationEntries(capabilities, presets = []) {
  const manual = [
    {
      id: "poster",
      name: "空白海报",
      description: "添加文字和图片，保存后导出。",
      category: "海报",
      kind: "manual",
      enabled: true,
    },
    {
      id: "templates",
      name: "模板海报",
      description: "选择可编辑模板，替换内容和配色。",
      category: "海报",
      kind: "manual",
      enabled: true,
      destination: "templates",
    },
    {
      id: "assets",
      name: "素材创作",
      description: "从上传图片或内置示例开始排版。",
      category: "图像",
      kind: "manual",
      enabled: true,
      destination: "assets",
    },
    {
      id: "studio",
      name: "多画板工作区",
      description: "在同一项目里组织和编辑多个画板。",
      category: "海报",
      kind: "manual",
      enabled: true,
      workspaceMode: "studio",
    },
  ];
  const recipes = (capabilities?.recipes || []).map((recipe) => ({
    ...recipe,
    recipeId: recipe.id,
    kind: "recipe",
    category: "海报",
  }));
  const design = capabilities?.modes?.find((mode) => mode.id === "design");
  const prompts = presets
    .filter(
      (item) =>
        item.category !== "视频" &&
        !/视频|动图/.test(item.name) &&
        !recipes.some((recipe) => recipe.name === item.name),
    )
    .map((item) => ({
      ...item,
      kind: "preset",
      enabled: !!design?.enabled,
      reason: design?.reason || "AI 创作尚未开放",
    }));
  return [...manual, ...recipes, ...prompts];
}

export function materialFor(item) {
  if (item.material) return item.material;
  const candidate =
    item.assetId ||
    (item.status || item.id?.startsWith("stock-") ? item.id : undefined);
  if (candidate?.startsWith("stock-")) return { kind: "stock", id: candidate };
  const match = (item.image || item.url || "").match(
    /^\/api\/assets\/([^/]+)(?:\/versions\/([^/]+))?\/file$/,
  );
  const id = candidate || match?.[1];
  if (id)
    return {
      kind: "asset",
      id,
      ...(item.assetVersionId || item.versionId || match?.[2]
        ? { versionId: item.assetVersionId || item.versionId || match?.[2] }
        : {}),
    };
  const stock = (item.image || item.url || "").match(
    /^\/assets\/(coffee|skincare|interior|fashion)\.jpg$/,
  );
  return stock ? { kind: "stock", id: `stock-${stock[1]}` } : undefined;
}
