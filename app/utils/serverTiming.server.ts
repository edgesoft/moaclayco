export type ServerTimingMetric = {
  description?: string;
  duration: number;
  name: string;
};

export async function measureServerTiming<T>(
  metrics: ServerTimingMetric[],
  name: string,
  operation: () => Promise<T>,
  description?: string
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    metrics.push({
      description,
      duration: performance.now() - startedAt,
      name,
    });
  }
}

export function formatServerTiming(metrics: ServerTimingMetric[]) {
  return metrics
    .map(({ description, duration, name }) => {
      const safeDescription = description?.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      return `${name};dur=${duration.toFixed(1)}${
        safeDescription ? `;desc="${safeDescription}"` : ""
      }`;
    })
    .join(", ");
}
