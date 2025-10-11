/**
 * Constraint and adjacency utilities for guest seating rules
 */

export type ConstraintKind = '' | 'must' | 'cannot';
export type ConstraintMap = Record<string, Record<string, ConstraintKind>>;
export type AdjMap = Record<string, string[]>;

export const getConstraint = (m: ConstraintMap, a: string, b: string): ConstraintKind => m?.[a]?.[b] || '';

export function setConstraint(m: ConstraintMap, a: string, b: string, v: ConstraintKind) {
  (m[a] ||= {}); (m[b] ||= {});
  if (v === '') {
    delete m[a][b];
    delete m[b][a];
  } else {
    m[a][b] = v;
    m[b][a] = v;
  }
}

export const isAdjacent = (adj: AdjMap, a: string, b: string): boolean => !!adj[a]?.includes(b);

export const addAdjacent = (adj: AdjMap, a: string, b: string) => {
  (adj[a] ||= []).push(b); 
  (adj[b] ||= []).push(a);
  adj[a] = [...new Set(adj[a])]; 
  adj[b] = [...new Set(adj[b])];
};

export const removeAdjacent = (adj: AdjMap, a: string, b: string) => {
  if (adj[a]) adj[a] = adj[a].filter(id => id !== b);
  if (adj[b]) adj[b] = adj[b].filter(id => id !== a);
};

export const degree = (adj: AdjMap, x: string): number => (adj[x] || []).length;

/**
 * Detect if adding edge (a, b) would create a cycle of length ≥ 3
 * Uses BFS with parent tracking
 */
export function closesCycle(adj: AdjMap, a: string, b: string): string[] | null {
  const graph: Record<string, string[]> = {};
  Object.keys(adj).forEach(key => { graph[key] = [...adj[key]]; });
  (graph[a] ||= []).push(b); 
  (graph[b] ||= []).push(a);

  const parent: Record<string, string | null> = {};
  const visited = new Set<string>();
  const stack: [string, string | null][] = [[a, null]];

  while (stack.length > 0) {
    const [node, p] = stack.pop()!;
    visited.add(node);
    parent[node] = p;

    for (const neighbor of (graph[node] || [])) {
      if (neighbor === p) continue;
      if (visited.has(neighbor)) {
        // Found a cycle - reconstruct it
        const cycle: string[] = [neighbor, node];
        let curr = node;
        while (parent[curr] !== null && parent[curr] !== neighbor) {
          curr = parent[curr]!;
          cycle.push(curr);
        }
        cycle.push(neighbor);
        if (cycle.length > 3) return cycle.slice(1);
      } else {
        stack.push([neighbor, node]);
      }
    }
  }
  return null;
}

