import { z } from "zod";
import type { Tx } from "../../server-infra/src/db.js";
import { HttpError } from "./common.js";

export const MaterialSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stock"),
    id: z.enum([
      "stock-coffee",
      "stock-skincare",
      "stock-interior",
      "stock-fashion",
    ]),
  }),
  z.object({
    kind: z.literal("asset"),
    id: z.string().min(1).max(100),
    versionId: z.string().min(1).max(100).optional(),
  }),
]);

/** Resolve under the caller's tenant transaction, before any project is created. */
export async function resolveMaterial(tx: Tx, input: unknown) {
  const material = MaterialSchema.parse(input);
  if (material.kind === "stock")
    return { src: `/assets/${material.id.slice(6)}.jpg` };
  const asset = (
    await tx.query(
      "SELECT id,current_version_id FROM assets WHERE id=$1 AND deleted_at IS NULL AND status='ready' FOR SHARE",
      [material.id],
    )
  ).rows[0];
  if (!asset)
    throw new HttpError(
      400,
      "INVALID_ASSET",
      "素材不可用，请重新选择已完成上传的图片",
    );
  const versionId = material.versionId || asset.current_version_id;
  const version = (
    await tx.query(
      "SELECT id FROM asset_versions WHERE id=$1 AND asset_id=$2",
      [versionId, asset.id],
    )
  ).rows[0];
  if (!version)
    throw new HttpError(
      400,
      "INVALID_ASSET_VERSION",
      "素材版本不可用，请重新选择",
    );
  return {
    src: `/api/assets/${asset.id}/versions/${version.id}/file`,
    assetId: asset.id as string,
    versionId: version.id as string,
  };
}

export async function normalizeBrand(tx: Tx, input: any) {
  const brand = z
    .object({
      name: z.string().max(100),
      colors: z
        .array(z.string().regex(/^#[0-9a-f]{6}$/i))
        .min(1)
        .max(20),
      description: z.string().max(3000).optional(),
      font: z.string().max(200).optional(),
      subtitle: z.string().max(300).optional(),
      logoAssetId: z.string().max(100).optional(),
      logoVersionId: z.string().max(100).optional(),
      logo: z.string().max(2048).optional(),
    })
    .parse(input);
  brand.font =
    brand.font?.includes("Georgia") || brand.font?.includes("Source Serif 4")
      ? "Source Serif 4 Variable"
      : "Noto Sans SC Variable";
  // Migrate the old editor's URL field and the asset library's ID field to one contract.
  const legacy = brand.logo?.match(
    /^\/api\/assets\/([^/]+)(?:\/versions\/([^/]+))?\/file$/,
  );
  const assetId = brand.logoAssetId ?? legacy?.[1];
  if (!assetId)
    return { ...brand, logo: "", logoAssetId: "", logoVersionId: "" };
  const material = await resolveMaterial(tx, {
    kind: "asset",
    id: assetId,
    versionId: brand.logoVersionId || legacy?.[2],
  });
  return {
    ...brand,
    logo: material.src,
    logoAssetId: material.assetId,
    logoVersionId: material.versionId,
  };
}
