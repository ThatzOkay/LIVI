// Shared callback shape FM/DAB backends use to tell RadioService "something
// changed, recompute + persist + broadcast" without each backend duplicating
// that orchestration logic itself.
export type BackendEvent = { type: 'change' } | { type: 'error'; message: string }
export type BackendNotify = (event: BackendEvent) => void
