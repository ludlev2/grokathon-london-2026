import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/snapshots')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/snapshots"!</div>
}
