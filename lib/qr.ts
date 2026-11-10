import QRCode from "qrcode";
import type { WarrantyPrint } from "@/components/warranty-document";
import { warrantyFor } from "@/lib/domain";
import type { AssetRecord } from "@/lib/types";

export async function qrFor(payload: object): Promise<{ image: string; url: string }> {
  const response = await fetch("/api/certificates/demo-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json() as { verifyUrl?: string; error?: string };
  if (!response.ok || !body.verifyUrl) throw new Error(body.error ?? "QR could not be created. Try again.");
  return { image: await QRCode.toDataURL(body.verifyUrl, { width: 640, margin: 4, errorCorrectionLevel: "L", color: { dark: "#0b3151", light: "#ffffff" } }), url: body.verifyUrl };
}

export async function warrantyPrint(record: AssetRecord, demoDate: string): Promise<WarrantyPrint> {
  const warranty = warrantyFor(record, demoDate);
  if (!warranty) throw new Error(`${record.assetRef} has no warranty yet.`);
  const { image } = await qrFor({ kind: "warranty", certificateNo: warranty.number, assetRef: record.assetRef, assetType: record.assetType, issuedDate: warranty.warrantyDate, expiryDate: warranty.validUntil, status: warranty.status });
  return { ...warranty, assetRef: record.assetRef, serialNo: record.serialNo, site: record.site, owner: record.owner, asOf: demoDate, qr: image };
}
