import { createHash } from 'crypto'
import type { PathStep } from '../types.js'

export class PathManager {
  private activePath: PathStep[] = []
  private completedPaths = new Set<string>()

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
    this.completedPaths.add(this.pathId())
  }

  isComplete(pathId: string): boolean {
    return this.completedPaths.has(pathId)
  }

  reset(steps: PathStep[] = []): void {
    this.activePath = [...steps]
  }

  get length(): number { return this.activePath.length }
}
