import type { Branch } from '../types.js'

export class BranchQueue {
  private queue: Branch[] = []
  private explored = new Set<string>()

  enqueue(branch: Branch): void {
    const key = `${branch.divergeNodeId}:${branch.elementId}:${branch.altValue}`
    if (this.explored.has(key)) return
    this.explored.add(key)
    this.queue.push(branch)
  }

  dequeue(): Branch | undefined {
    return this.queue.shift()
  }

  get size(): number { return this.queue.length }
  get isEmpty(): boolean { return this.queue.length === 0 }
}
