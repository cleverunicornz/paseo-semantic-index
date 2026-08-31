import type { PluginContext } from "@getpaseo/plugin"
import { Dashboard } from "./dashboard.client"
import {
  registerWorkspaceRpc,
  reindexWorkspaceRpc,
  releaseWorkspaceRpc,
  serviceStatusRpc,
  workspaceStatusRpc,
} from "./rpc.shared"
import {
  closeRuntime,
  getServiceStatus,
  getWorkspaceStatus,
  registerWorkspace,
  reindexWorkspace,
  releaseWorkspace,
} from "./runtime.server"
import { WorkspaceIndexPanel } from "./workspace.client"

export default function contribute(plugin: PluginContext) {
  let cleanup = () => Promise.resolve()

  plugin.handle(serviceStatusRpc, ((cleanup = closeRuntime), getServiceStatus))
  plugin.handle(workspaceStatusRpc, getWorkspaceStatus)
  plugin.handle(registerWorkspaceRpc, registerWorkspace)
  plugin.handle(releaseWorkspaceRpc, releaseWorkspace)
  plugin.handle(reindexWorkspaceRpc, reindexWorkspace)

  plugin.addSurface("semantic-index", Dashboard)
  plugin.addSidebarItem({
    id: "semantic-index",
    title: "Semantic index",
    icon: "ScanSearch",
    surface: "semantic-index",
  })
  plugin.addWorkspacePanel({
    id: "semantic-index-workspace",
    title: "Semantic index",
    icon: "ScanSearch",
    context: "workspace",
    Component: WorkspaceIndexPanel,
  })
  plugin.addCommandCenterItem({
    id: "open-semantic-index",
    title: "Open semantic index dashboard",
    icon: "ScanSearch",
    keywords: ["code", "search", "indexing", "qdrant"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("semantic-index")
    },
  })
  plugin.addCommandCenterItem({
    id: "open-workspace-semantic-index",
    title: "Open workspace semantic index",
    icon: "ScanSearch",
    keywords: ["code", "search", "indexing"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("semantic-index-workspace")
    },
  })

  return cleanup
}
