import type { Branch, PredictedRoute } from '../types.js'

export class BranchQueue {
  private queue: Branch[] = []
  private explored = new Set<string>()

  enqueue(branch: Branch): void {
    const key = `${branch.divergeNodeId}:${branch.elementId}:${branch.altValue}`
    if (this.explored.has(key)) return
    this.explored.add(key)
    this.queue.push(branch)
  }

  /** Add a predicted route to the front of the queue so it runs before radio alternates */
  addPredicted(route: PredictedRoute): void {
    if (route.steps.length === 0) return
    const divergeNodeId = route.steps[0].nodeId
    const key = `predicted:${route.routeId}`
    if (this.explored.has(key)) return
    this.explored.add(key)
    const branch: Branch = {
      pathId:         route.routeId,
      divergeNodeId,
      divergeStepIdx: 0,
      altValue:       route.description,
      altKey:         null,
      elementId:      route.steps[0].elementId,
      steps:          [],
    }
    this.queue.unshift(branch)
  }

  dequeue(): Branch | undefined {
    return this.queue.shift()
  }

  get size(): number { return this.queue.length }
  get isEmpty(): boolean { return this.queue.length === 0 }
}
