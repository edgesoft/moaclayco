export const createImageDraftId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export async function cleanupImageDraftUrl(
  draftId: string,
  url: string,
  keepalive = false
) {
  const formData = new FormData();
  formData.append("draftId", draftId);
  formData.append("url", url);
  const response = await fetch("/admin/image-draft/delete", {
    body: formData,
    keepalive,
    method: "POST",
  });
  return response.ok;
}
