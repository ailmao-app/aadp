/**
 * `collectGraphV1` — the whole graph in one object, for callers that do not
 * need to stream.
 *
 * It is a DRAIN of `traverseGraphV1` and nothing else: no second traversal
 * algorithm, no re-sorting. That is what makes "the stream and the collected
 * graph agree on content and order" a property of the code rather than of two
 * implementations kept in sync by hand.
 */
import type { EntityV1 } from "../../client/v1.0/index.js";
import { traverseGraphV1 } from "./traversal.js";
import type { CrossModuleGraphV1, GraphTraversalOptions } from "./types.js";

export async function collectGraphV1(
  root: string | EntityV1,
  options: GraphTraversalOptions
): Promise<CrossModuleGraphV1> {
  const graph: CrossModuleGraphV1 = {
    nodes: [],
    references: [],
    edges: [],
    expansions: [],
    summary: { stopReason: "exhausted", partial: false, nodes: 0, edges: 0, requests: 0, unsupportedModules: {} },
  };

  for await (const event of traverseGraphV1(root, options)) {
    switch (event.type) {
      case "node":
        graph.nodes.push(event.node);
        break;
      case "reference":
        graph.references.push(event.reference);
        break;
      case "edge":
        graph.edges.push(event.edge);
        break;
      case "expansion":
        graph.expansions.push(event.expansion);
        break;
      case "complete":
        graph.summary = event.summary;
        break;
    }
  }

  return graph;
}
