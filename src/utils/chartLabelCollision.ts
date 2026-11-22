export interface VerticalLabelItem {
  id: string;
  rawY: number;
  priority: number;
}

/**
 * Cluster-centered vertical anti-collision solver (Pool-Adjacent-Violators).
 * Guarantees a minimum `minGap` px vertical separation between adjacent labels
 * while strictly clamping every label inside `[minY, maxY]` so no label clips
 * at the top or bottom edge of the SVG viewport.
 */
export function resolveVerticalLabelCollisions<T extends VerticalLabelItem>(
  items: T[],
  minGap = 16,
  minY = 12,
  maxY = 338
): Array<T & { resolvedY: number }> {
  if (items.length === 0) return [];
  const safeMinY = Math.min(minY, maxY);
  const safeMaxY = Math.max(minY, maxY);
  const availableSpan = Math.max(0, safeMaxY - safeMinY);

  const sorted = [...items].sort((a, b) =>
    Math.abs(a.rawY - b.rawY) < 0.01 ? b.priority - a.priority : a.rawY - b.rawY
  );

  const effectiveGap =
    sorted.length > 1 && availableSpan < (sorted.length - 1) * minGap
      ? Math.max(12, availableSpan / (sorted.length - 1))
      : minGap;

  interface Cluster {
    items: T[];
    weightedSum: number;
    weightTotal: number;
    startY: number;
    endY: number;
  }

  const computeClusterBounds = (clusterItems: T[], weightedSum: number, weightTotal: number) => {
    const span = (clusterItems.length - 1) * effectiveGap;
    const meanY = weightTotal > 0 ? weightedSum / weightTotal : safeMinY;
    const clampedStart = Math.max(
      safeMinY,
      Math.min(safeMaxY - span, meanY - span / 2)
    );
    return { startY: clampedStart, endY: clampedStart + span };
  };

  const stack: Cluster[] = [];
  for (const item of sorted) {
    const clampedRaw = Math.max(safeMinY, Math.min(safeMaxY, item.rawY));
    const weight = 1 + Math.max(0, item.priority) * 0.02;
    let current: Cluster = {
      items: [item],
      weightedSum: clampedRaw * weight,
      weightTotal: weight,
      startY: clampedRaw,
      endY: clampedRaw,
    };

    while (stack.length > 0) {
      const prev = stack[stack.length - 1];
      if (prev.endY + effectiveGap <= current.startY + 0.001) {
        break;
      }
      stack.pop();
      const mergedItems = [...prev.items, ...current.items];
      const mergedWeightedSum = prev.weightedSum + current.weightedSum;
      const mergedWeightTotal = prev.weightTotal + current.weightTotal;
      const { startY, endY } = computeClusterBounds(
        mergedItems,
        mergedWeightedSum,
        mergedWeightTotal
      );
      current = {
        items: mergedItems,
        weightedSum: mergedWeightedSum,
        weightTotal: mergedWeightTotal,
        startY,
        endY,
      };
    }

    stack.push(current);
  }

  const resolved: Array<T & { resolvedY: number }> = [];
  for (const cluster of stack) {
    cluster.items.forEach((item, idx) => {
      const y = Math.max(safeMinY, Math.min(safeMaxY, cluster.startY + idx * effectiveGap));
      resolved.push({ ...item, resolvedY: y });
    });
  }

  return resolved;
}
