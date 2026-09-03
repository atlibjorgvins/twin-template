// Bridge between Image Studio and other tools (today: the Evergreen
// machine). Applies a template to a campaign candidate — either as a
// throwaway preview URL or as a real render uploaded to Directus with
// a generated_image audit row.
import {
  listOrgPhotos,
  uploadFile,
  type CampaignCandidate,
  type OrganizationPhoto
} from '$lib/directus';
import {
  createGeneratedImage,
  getProjectContext,
  studioFolderId,
  type ImageTemplate,
  type StudioLayer
} from './data';
import { renderToBlob } from './render';

function bestGalleryFile(photos: OrganizationPhoto[]): string | null {
  const group = photos.find(
    (p) =>
      typeof p.type_id === 'object' &&
      /group/i.test((p.type_id as { name?: string })?.name ?? '')
  );
  return (group ?? photos[0])?.file_id ?? null;
}

/** The photo for the template's `base` slot, honouring the slot's own
 *  record-image / team-photo policy. */
export async function resolveStudioBaseImage(
  template: ImageTemplate,
  candidate: CampaignCandidate
): Promise<string | null> {
  const base = (template.layers ?? []).find((l) => l.type === 'base');
  const policy = base && base.type === 'base' ? base.source : 'record';
  if (policy !== 'gallery' || candidate.collection !== 'organization') {
    return candidate.imageId;
  }
  try {
    const ph = (await listOrgPhotos(candidate.id)).filter((g) => !!g.file_id);
    return bestGalleryFile(ph) ?? candidate.imageId;
  } catch {
    return candidate.imageId;
  }
}

async function renderCandidateBlob(
  template: ImageTemplate,
  candidate: CampaignCandidate,
  projectName?: string | null
): Promise<Blob> {
  const [baseImageId, projCtx] = await Promise.all([
    resolveStudioBaseImage(template, candidate),
    template.project_id ? getProjectContext(template.project_id) : Promise.resolve(null)
  ]);
  return renderToBlob({
    width: template.width ?? 1080,
    height: template.height ?? 1080,
    background: template.background ?? null,
    layers: (template.layers ?? []) as StudioLayer[],
    rc: {
      candidate,
      // The template's own project wins for {project}; the campaign's
      // first filter project is the fallback.
      projectName: projCtx?.name ?? projectName,
      baseImageId,
      projectColors: projCtx?.colors ?? null,
      roleLogos: projCtx?.roleLogos ?? null
    }
  });
}

/** Render for a live preview. Returns an object URL — the caller owns
 *  it and must revoke the previous one when replacing. */
export async function renderCandidatePreviewUrl(
  template: ImageTemplate,
  candidate: CampaignCandidate,
  projectName?: string | null
): Promise<string> {
  const blob = await renderCandidateBlob(template, candidate, projectName);
  return URL.createObjectURL(blob);
}

function slug(s: string): string {
  return (
    s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) ||
    'image'
  );
}

/** Render and persist: PNG to Files → Studio + a generated_image row.
 *  Returns the new Directus file id (ready to ride on a post). */
export async function renderCandidateToDirectus(
  template: ImageTemplate,
  candidate: CampaignCandidate,
  projectName?: string | null
): Promise<string> {
  const blob = await renderCandidateBlob(template, candidate, projectName);
  const file = new File(
    [blob],
    `${slug(template.name ?? 'studio')}-${slug(candidate.name)}.png`,
    { type: 'image/png' }
  );
  const folder = await studioFolderId();
  const fileId = await uploadFile(file, {
    title: `${template.name ?? 'Studio'} — ${candidate.name}`,
    folder: folder ?? undefined
  });
  await createGeneratedImage({
    template_id: template.id,
    item_collection: candidate.collection,
    item_id: String(candidate.id),
    item_label: candidate.name,
    file_id: fileId,
    tokens: {
      name: candidate.name,
      nickname: candidate.nickname ?? candidate.name,
      description: candidate.description?.trim() || candidate.descriptionAlt || '',
      website: candidate.website ?? '',
      project: projectName ?? ''
    }
  });
  return fileId;
}
