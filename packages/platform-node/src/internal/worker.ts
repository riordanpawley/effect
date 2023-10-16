import * as Worker from "@effect/platform/Worker"
import { WorkerError } from "@effect/platform/WorkerError"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import type * as WorkerThreads from "node:worker_threads"

const platformWorkerImpl = Worker.PlatformWorker.of({
  [Worker.PlatformWorkerTypeId]: Worker.PlatformWorkerTypeId,
  spawn<I, O>(worker_: unknown) {
    return Effect.gen(function*(_) {
      const worker = worker_ as WorkerThreads.Worker
      yield* _(Effect.addFinalizer(() =>
        Effect.suspend(() => {
          worker.postMessage([1])
          return Effect.async<never, never, void>((resume) => {
            worker.once("exit", () => {
              resume(Effect.unit)
            })
          })
        })
      ))
      const fiberId = yield* _(Effect.fiberId)
      const queue = yield* _(Queue.unbounded<Worker.BackingWorker.Message<O>>())
      yield* _(Effect.addFinalizer(() => Queue.shutdown(queue)))
      const fiber = yield* _(
        Effect.async<never, WorkerError, never>((resume) => {
          worker.on("message", (message: Worker.BackingWorker.Message<O>) => {
            queue.unsafeOffer(message)
          })
          worker.on("messageerror", (error) => {
            resume(Effect.fail(WorkerError("decode", error)))
          })
          worker.on("error", (error) => {
            resume(Effect.fail(WorkerError("unknown", error)))
          })
          worker.on("exit", (code) => {
            resume(Effect.fail(WorkerError("unknown", new Error(`exited with code ${code}`))))
          })
        }),
        Effect.forkDaemon
      )
      yield* _(Effect.addFinalizer(() => fiber.interruptAsFork(fiberId)))
      const join = Fiber.join(fiber)
      const send = (message: I, transfers?: ReadonlyArray<unknown>) =>
        Effect.sync(() => worker.postMessage([0, message], transfers as any))
      return { join, queue, send }
    })
  }
})

/** @internal */
export const layerWorker = Layer.succeed(Worker.PlatformWorker, platformWorkerImpl)

/** @internal */
export const layerManager = Layer.provide(layerWorker, Worker.layerManager)

/** @internal */
export const makePool = Worker.makePool<WorkerThreads.Worker>()

/** @internal */
export const makePoolLayer = Worker.makePoolLayer<WorkerThreads.Worker>(layerManager)
