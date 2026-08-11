/**
 * Evidence `1.0` graph resolution (specification.md §10, §15) — the two-hop
 * walk `answer → claim → evidence` and its one-hop `claim → evidence` half.
 *
 * Every fetch goes through the shared, per-budget canonical resolution layer
 * (`../../../shared/canonical-resolution.js`), which Answer `1.0` uses too.
 * That sharing is the point: the layer's cache is keyed by budget, and a
 * canonical key it has never itself resolved is reported `invalid`, so an
 * Evidence walk resolving through some OTHER path over the same budget would
 * manufacture false `invalid` results for Answer, and vice versa (ADR-0010
 * §10). It also carries the released resolution-context binding, so an
 * Evidence entry point cannot become a way around it.
 *
 * `resolveAnswerEvidenceV1` deliberately does NOT call `resolveAnswerTargets`:
 * that function always collects `authorship.source_targets` as well, which is
 * out of scope for Evidence (specification.md §15) and would spend shared
 * budget — possibly all of it — on generated-summary provenance before the
 * claim → evidence walk even starts. Evidence collects its own references and
 * resolves them through the same shared layer instead; it neither changes
 * Answer's public API nor duplicates the network stack.
 *
 * Nothing here fetches `source.url` or `publisher.url`: those are metadata
 * (specification.md §13). The only edge that is ever followed is
 * `claim.evidence_refs[]`, whose `target_type` is the constant `evidence` —
 * which is also why there is no cycle guard in this file: the `1.0` wire
 * model cannot express a cycle (§7.1).
 */
import { AadpDiscoveryBudgetExceededError, AbortedError } from "../../../../client/v1.0/index.js";
import { canonicalTargetKey, chargeDepth } from "../../../relations/v1.0/client/budget.js";
import {
  budgetResolutionStateFor,
  resolveCanonicalTarget,
  type BudgetResolutionState,
} from "../../../shared/canonical-resolution.js";
import { validateEvidenceEntityV1 } from "../entity.js";
import type { RelationTargetV1 } from "../../../relations/v1.0/types.js";
import type { AnswerDocumentV1, AnswerEntityReferenceV1 } from "../../../answer/v1.0/types.js";
import type { EvidenceClaimDocumentV1 } from "../types.js";
import type {
  EvidenceGraph,
  EvidenceGraphEdge,
  EvidenceGraphNode,
  EvidenceGraphReference,
  EvidenceResolveOptions,
  EvidenceTargetResolutionStatus,
} from "./types.js";

/** The `related_entities` target types Evidence claims for itself (specification.md §15). */
const EVIDENCE_TARGET_TYPES = new Set(["claim", "evidence"]);

const STOPPED_BEFORE_ATTEMPT = "Resolution stopped before this reference was attempted.";

/** Root marker for `resolveClaimEvidenceV1`'s caller-supplied claim, which has no canonical target of its own. */
const ROOT_CLAIM_KEY = "";

function isGlobalStop(err: unknown): boolean {
  return err instanceof AadpDiscoveryBudgetExceededError || err instanceof AbortedError;
}

interface Walk {
  state: BudgetResolutionState;
  options: EvidenceResolveOptions;
  nodes: EvidenceGraphNode[];
  nodeByKey: Map<string, EvidenceGraphNode>;
  references: EvidenceGraphReference[];
  edges: EvidenceGraphEdge[];
  partial: boolean;
}

function newWalk(options: EvidenceResolveOptions): Walk {
  return {
    // Binds (or re-checks) this budget's resolution context BEFORE anything
    // can charge the budget or touch the network, so a mismatched call is a
    // no-op rather than a half-applied one.
    state: budgetResolutionStateFor(options.budget, options),
    options,
    nodes: [],
    nodeByKey: new Map(),
    references: [],
    edges: [],
    partial: false,
  };
}

/** Records a node in discovery order, or returns the one already recorded for this canonical key. */
function ensureNode(walk: Walk, node: EvidenceGraphNode): EvidenceGraphNode {
  const existing = walk.nodeByKey.get(node.key);
  if (existing) return existing;
  walk.nodeByKey.set(node.key, node);
  walk.nodes.push(node);
  return node;
}

/** Per-occurrence outcome: the shared node plus THIS occurrence's own verdict. */
interface OccurrenceResult {
  key: string;
  status: EvidenceTargetResolutionStatus;
  message?: string;
  node: EvidenceGraphNode;
}

function describeIssues(result: ReturnType<typeof validateEvidenceEntityV1>): string {
  const parts = [...result.errors.map((e) => JSON.stringify(e)), ...result.semanticIssues.map((i) => `${i.code}: ${i.message}`)];
  return `Target is not a valid Evidence 1.0 entity: ${parts.join("; ")}`;
}

/**
 * Resolves one occurrence of a target.
 *
 * The canonical part — fetch, envelope schema/checksum, Evidence entity
 * validation — is computed at most once per canonical key per walk and
 * stored on the node. The `target_type` verdict is recomputed for EVERY
 * occurrence against the fetched entity's own `type` (specification.md
 * §10.4): two references may legally declare different types for one
 * canonical target, and neither may poison the other's verdict, in either
 * order.
 */
async function resolveOccurrence(
  walk: Walk,
  target: RelationTargetV1,
  expectedType: string,
  depth: number,
  context: string
): Promise<OccurrenceResult> {
  const key = canonicalTargetKey(target.id, target.url);

  const known = walk.nodeByKey.get(key);
  if (known) return { key, node: known, ...verdictFor(known, target, expectedType) };

  // Depth is charged along the answer → claim → evidence edges, on the
  // caller-owned budget, with no new dimension and no raised default
  // (specification.md §10.3). Exceeding it is a global stop, exactly like
  // any other budget dimension.
  try {
    chargeDepth(walk.options.budget, depth, context);
  } catch (err) {
    if (isGlobalStop(err)) {
      walk.partial = true;
      const node = ensureNode(walk, { key, status: "budget-exhausted", message: (err as Error).message });
      return { key, node, status: node.status, message: node.message };
    }
    throw err;
  }

  const resolution = await resolveCanonicalTarget(walk.state, target, expectedType, walk.options, context);
  if (resolution.status === "stopped") {
    walk.partial = true;
    const node = ensureNode(walk, { key, status: "budget-exhausted", message: resolution.message });
    return { key, node, status: node.status, message: node.message };
  }

  const outcome = resolution.outcome;
  if (!outcome.ok) {
    // A target the URL/DNS policy refused to fetch is `forbidden` for
    // Evidence — access control, NOT a broken graph (specification.md
    // §10.2), so it must not fail the "no dangling reference" gate. Answer
    // `1.0` released the same case as `invalid` and keeps that mapping; the
    // shared layer reports the underlying issue code so each module can
    // classify it under its own released contract.
    const status = outcome.issueCode === "blocked_url" ? "forbidden" : outcome.status;
    const node = ensureNode(walk, { key, status, message: outcome.message });
    return { key, node, status: node.status, message: node.message };
  }

  // The entity was fetched and is a valid AADP envelope; whether it is a
  // valid Evidence entity is a property of the TARGET, not of any one
  // reference, so it belongs on the node and applies to every occurrence.
  const validation = validateEvidenceEntityV1(outcome.entity);
  if (!validation.valid || !validation.entity) {
    const node = ensureNode(walk, { key, status: "invalid", message: describeIssues(validation) });
    return { key, node, status: node.status, message: node.message };
  }

  const node = ensureNode(walk, {
    key,
    kind: validation.entity.kind,
    status: "resolved",
    entity: outcome.entity,
    document: validation.entity.document,
  });
  return { key, node, ...verdictFor(node, target, expectedType) };
}

/** This occurrence's verdict over a shared node — see `resolveOccurrence`. */
function verdictFor(
  node: EvidenceGraphNode,
  target: RelationTargetV1,
  expectedType: string
): { status: EvidenceTargetResolutionStatus; message?: string } {
  if (node.status !== "resolved") return { status: node.status, message: node.message };
  const actualType = node.entity?.type;
  if (actualType !== expectedType) {
    return {
      status: "invalid",
      message:
        `Target at ${target.url} has type "${actualType}", which does not match this ` +
        `reference's declared target_type "${expectedType}".`,
    };
  }
  return { status: "resolved" };
}

/**
 * Steps 4-6 of specification.md §10.5's algorithm: walk one resolved claim's
 * `evidence_refs` in input order, adding one edge per occurrence. Evidence is
 * a leaf — nothing is expanded past it, which is why no `markExpanded`/
 * `expandedTargets` bookkeeping is needed here.
 */
async function expandClaim(walk: Walk, claim: EvidenceClaimDocumentV1, from: string, depth: number): Promise<void> {
  const refs = claim.evidence_refs ?? [];
  for (const [index, ref] of refs.entries()) {
    const confidence = ref.confidence === undefined ? {} : { confidence: ref.confidence };
    if (walk.partial) {
      // Past the stopping point: still reported, never silently dropped, and
      // with a node so every edge's `to` resolves to one.
      const key = canonicalTargetKey(ref.target.id, ref.target.url);
      ensureNode(walk, { key, status: "budget-exhausted", message: STOPPED_BEFORE_ATTEMPT });
      walk.edges.push({ from, to: key, index, stance: ref.stance, ...confidence, status: "budget-exhausted", message: STOPPED_BEFORE_ATTEMPT });
      continue;
    }
    const result = await resolveOccurrence(walk, ref.target, ref.target_type, depth, `evidence.evidence_refs[${index}]`);
    walk.edges.push({
      from,
      to: result.key,
      index,
      stance: ref.stance,
      ...confidence,
      status: result.status,
      ...(result.message ? { message: result.message } : {}),
    });
  }
}

function graphOf(walk: Walk): EvidenceGraph {
  return { nodes: walk.nodes, references: walk.references, edges: walk.edges, partial: walk.partial };
}

/**
 * Resolves one claim's `evidence_refs` on the caller's budget — steps 4-6 of
 * the algorithm, with the claim already in hand.
 *
 * `references` is empty (there is no Answer to have referenced anything), and
 * every edge's `from` is the empty-string root marker: a claim document on its
 * own has no canonical `{id, url}` identity to key a node by. Use
 * `resolveAnswerEvidenceV1` when the claim was itself reached as an entity and
 * its key matters.
 */
export async function resolveClaimEvidenceV1(
  claim: EvidenceClaimDocumentV1,
  options: EvidenceResolveOptions
): Promise<EvidenceGraph> {
  const walk = newWalk(options);
  await expandClaim(walk, claim, ROOT_CLAIM_KEY, 1);
  return graphOf(walk);
}

/**
 * Resolves an Answer's citation graph two hops deep — specification.md §10.5:
 *
 * 1. Filter `related_entities` to `target_type` ∈ {`claim`, `evidence`},
 *    keeping input order and the ORIGINAL index.
 * 2. Resolve each filtered reference through the shared canonical resolver.
 * 3. Check each reference's own `target_type`, validate the entity, record a
 *    node and a per-occurrence `references[]` verdict.
 * 4. For every resolved CLAIM, in that same order, walk its `evidence_refs`
 *    in input order.
 * 5. Reuse an already-fetched evidence entity on a cache hit — one fetch per
 *    canonical target per walk, however many claims cite it (fan-in).
 * 6. Stop. Evidence is a leaf.
 *
 * Consequently a mixed-order Answer (pointing at both `E` and a claim `C1`
 * that cites `E`) produces an equivalent graph in either order, and `E` is
 * fetched exactly once.
 *
 * `authorship.source_targets` is never read, never resolved and never
 * charged, whatever the authorship kind.
 */
export async function resolveAnswerEvidenceV1(
  answer: AnswerDocumentV1,
  options: EvidenceResolveOptions
): Promise<EvidenceGraph> {
  const walk = newWalk(options);

  const filtered: Array<{ index: number; reference: AnswerEntityReferenceV1 }> = [];
  (answer.related_entities ?? []).forEach((reference, index) => {
    if (EVIDENCE_TARGET_TYPES.has(reference.target_type)) filtered.push({ index, reference });
  });

  /** Resolved claim nodes in discovery order — the expansion order of step 4. */
  const claims: EvidenceGraphNode[] = [];

  for (const { index, reference } of filtered) {
    if (walk.partial) {
      const key = canonicalTargetKey(reference.target.id, reference.target.url);
      ensureNode(walk, { key, status: "budget-exhausted", message: STOPPED_BEFORE_ATTEMPT });
      walk.references.push({ index, reference, key, status: "budget-exhausted", message: STOPPED_BEFORE_ATTEMPT });
      continue;
    }
    const result = await resolveOccurrence(walk, reference.target, reference.target_type, 1, `evidence.related_entities[${index}]`);
    walk.references.push({
      index,
      reference,
      key: result.key,
      status: result.status,
      ...(result.message ? { message: result.message } : {}),
    });
    // Only a reference that resolved AND agreed on `target_type: "claim"` is
    // expanded: a claim reached through a reference that mis-declared its
    // type is `invalid` for that occurrence, and expanding it anyway would
    // spend budget on an edge the caller was told it does not have.
    if (result.status === "resolved" && result.node.kind === "claim") claims.push(result.node);
  }

  for (const claim of claims) {
    await expandClaim(walk, claim.document as EvidenceClaimDocumentV1, claim.key, 2);
  }

  return graphOf(walk);
}
