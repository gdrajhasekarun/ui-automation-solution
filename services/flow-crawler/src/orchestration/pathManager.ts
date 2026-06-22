import { createHash } from 'crypto'
import type { PathStep } from '../types.js'

export class PathManager {
  private activePath: PathStep[] = []
  private completedPaths = new Set<string>()
  private _completedPathSteps: Array<{ pathId: string; steps: PathStep[] }> = []

  push(step: PathStep): void {
    this.activePath.push(step)
  }

  getActivePath(): PathStep[] {
    return [...this.activePath]
  }

  pathId(): string {
    const seed = this.activePath.map(s =>
      `${s.nodeId}:${s.decision.elementId}:${s.decision.value ?? ''}`
    ).join('|')
    return createHash('sha1').update(seed).digest('hex').slice(0, 12)
  }

  markComplete(): void {
    const id = this.pathId()
    this.completedPaths.add(id)
    this._completedPathSteps.push({ pathId: id, steps: this.getActivePath() })
  }

  getCompletedPaths(): Array<{ pathId: string; steps: PathStep[] }> {
    return [...this._completedPathSteps]
  }

  isComplete(pathId: string): boolean {
    return this.completedPaths.has(pathId)
  }

  reset(steps: PathStep[] = []): void {
    this.activePath = [...steps]
  }

  get length(): number { return this.activePath.length }
}
