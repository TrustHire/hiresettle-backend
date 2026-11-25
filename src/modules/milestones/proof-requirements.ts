import { BadRequestException } from '@nestjs/common';

export const MAX_PROOF_REQUIREMENTS = 20;
export const MAX_REQUIREMENT_LENGTH = 200;

export interface RequirementEvidence {
  requirement: string;
  proofUrl?: string | null;
  note?: string | null;
}

export interface ProofChecklistItem {
  requirement: string;
  satisfied: boolean;
  proofUrl: string | null;
  note: string | null;
}

/** Requirements are matched case/whitespace-insensitively. */
const keyOf = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Trim, drop blanks, de-duplicate and bound a requirement list. Throws on invalid input. */
export function normalizeProofRequirements(input: unknown, field = 'proofRequirements'): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.some((r) => typeof r !== 'string')) {
    throw new BadRequestException(`${field} must be an array of strings`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input as string[]) {
    const label = raw.trim().replace(/\s+/g, ' ');
    if (!label) continue;
    if (label.length > MAX_REQUIREMENT_LENGTH) {
      throw new BadRequestException(`${field} items must be at most ${MAX_REQUIREMENT_LENGTH} characters`);
    }
    if (seen.has(keyOf(label))) continue;
    seen.add(keyOf(label));
    out.push(label);
  }
  if (out.length > MAX_PROOF_REQUIREMENTS) {
    throw new BadRequestException(`${field} may contain at most ${MAX_PROOF_REQUIREMENTS} items`);
  }
  return out;
}

/**
 * Resolve the requirements for a new milestone. Precedence:
 *   1. explicit `proofRequirements` on the milestone input
 *   2. `proofRequirements` on the template's milestone entry (already merged into `m` when the template supplied the milestones)
 *   3. template-level `defaultProofRequirements[kind]`
 */
export function resolveProofRequirements(milestone: any, milestoneConfig: any): string[] {
  if (milestone?.proofRequirements !== undefined) {
    return normalizeProofRequirements(milestone.proofRequirements);
  }
  const defaults = milestoneConfig?.defaultProofRequirements?.[milestone?.kind];
  return normalizeProofRequirements(defaults, `defaultProofRequirements.${milestone?.kind}`);
}

/** Validates the proof-requirement parts of a template's milestoneConfig. */
export function validateTemplateProofRequirements(milestoneConfig: any): void {
  if (!milestoneConfig || typeof milestoneConfig !== 'object') return;
  const defaults = milestoneConfig.defaultProofRequirements;
  if (defaults !== undefined) {
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
      throw new BadRequestException('defaultProofRequirements must be an object keyed by milestone kind');
    }
    for (const [kind, list] of Object.entries(defaults)) {
      if (kind !== 'PLACEMENT' && kind !== 'RETENTION') {
        throw new BadRequestException(`defaultProofRequirements has unknown milestone kind "${kind}"`);
      }
      normalizeProofRequirements(list, `defaultProofRequirements.${kind}`);
    }
  }
  if (Array.isArray(milestoneConfig.milestones)) {
    milestoneConfig.milestones.forEach((m: any, i: number) =>
      normalizeProofRequirements(m?.proofRequirements, `milestones[${i}].proofRequirements`),
    );
  }
}

/**
 * Every requirement must be covered by an evidence item with a URL or a note.
 * Returns the evidence in requirement order, using the milestone's canonical labels.
 */
export function assertRequirementsSatisfied(
  requirements: string[],
  evidence: RequirementEvidence[] | undefined,
): RequirementEvidence[] {
  if (!requirements.length) return [];

  const byKey = new Map<string, RequirementEvidence>();
  for (const item of evidence ?? []) {
    if (item.proofUrl?.trim() || item.note?.trim()) byKey.set(keyOf(item.requirement), item);
  }

  const unknown = (evidence ?? []).filter((e) => !requirements.some((r) => keyOf(r) === keyOf(e.requirement)));
  if (unknown.length) {
    throw new BadRequestException(
      `Evidence provided for requirements this milestone does not have: ${unknown.map((u) => `"${u.requirement}"`).join(', ')}`,
    );
  }

  const missing = requirements.filter((r) => !byKey.has(keyOf(r)));
  if (missing.length) {
    throw new BadRequestException({
      message: `Proof is missing required items: ${missing.join(', ')}`,
      missingRequirements: missing,
    });
  }

  return requirements.map((r) => {
    const e = byKey.get(keyOf(r))!;
    return { requirement: r, proofUrl: e.proofUrl?.trim() || null, note: e.note?.trim() || null };
  });
}

/** Checklist view of a milestone's requirements against its latest proof version. */
export function buildProofChecklist(requirements: string[], latestEvidence: unknown) {
  const evidence = Array.isArray(latestEvidence) ? (latestEvidence as RequirementEvidence[]) : [];
  const items: ProofChecklistItem[] = requirements.map((requirement) => {
    const e = evidence.find((x) => x && keyOf(String(x.requirement)) === keyOf(requirement));
    const satisfied = !!(e && (e.proofUrl || e.note));
    return { requirement, satisfied, proofUrl: e?.proofUrl ?? null, note: e?.note ?? null };
  });
  const completed = items.filter((i) => i.satisfied).length;
  return {
    total: items.length,
    completed,
    complete: completed === items.length,
    percent: items.length ? Math.round((completed / items.length) * 100) : 100,
    items,
  };
}
