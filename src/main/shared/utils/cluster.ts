type ClusterDisplayMap = { main?: boolean; dash?: boolean; aux?: boolean }

type ClusterAwareConfig = {
  cluster?: ClusterDisplayMap | null
}

export function isClusterDisplayed(cfg: ClusterAwareConfig | null | undefined): boolean {
  const c = cfg?.cluster
  if (!c) return false
  return c.main === true || c.dash === true || c.aux === true
}

export type ClusterScreen = 'main' | 'dash' | 'aux'

export function clusterTargetScreens(cfg: ClusterAwareConfig | null | undefined): ClusterScreen[] {
  const c = cfg?.cluster
  if (!c) return []
  const out: ClusterScreen[] = []
  if (c.main === true) out.push('main')
  if (c.dash === true) out.push('dash')
  if (c.aux === true) out.push('aux')
  return out
}
