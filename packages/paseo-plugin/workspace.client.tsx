import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin"
import React, { useMemo, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native"
import {
  registerWorkspaceRpc,
  reindexWorkspaceRpc,
  releaseWorkspaceRpc,
  workspaceStatusRpc,
} from "./rpc.shared"

export function WorkspaceIndexPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, (item) => ({
    id: item.id,
    projectId: item.projectId,
    name: item.name,
    directory: item.directory,
    projectRootPath: item.projectRootPath,
    kind: item.kind,
  }))
  const statusRpc = useRpc(workspaceStatusRpc)
  const registerRpc = useRpc(registerWorkspaceRpc)
  const releaseRpc = useRpc(releaseWorkspaceRpc)
  const reindexRpc = useRpc(reindexWorkspaceRpc)
  const queryClient = useQueryClient()
  const [confirmRelease, setConfirmRelease] = useState(false)
  const queryKey = ["semantic-index", "workspace", workspace?.directory]
  const status = useQuery({
    queryKey,
    queryFn: () => statusRpc({ path: workspace!.directory }),
    enabled: !!workspace,
    refetchInterval: 2_000,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey })
  const register = useMutation({
    mutationFn: async () => {
      if (!workspace) throw new Error("Workspace is unavailable")
      if (workspace.kind === "worktree") {
        await registerRpc({
          id: `${workspace.projectId}:primary`,
          path: workspace.projectRootPath,
        })
      }
      return registerRpc({
        id: workspace.id,
        path: workspace.directory,
        baselinePath: workspace.kind === "worktree" ? workspace.projectRootPath : undefined,
      })
    },
    onSuccess: refresh,
  })
  const reindex = useMutation({
    mutationFn: async () => {
      if (!status.data) throw new Error("Workspace index is not registered")
      return reindexRpc({ id: status.data.id })
    },
    onSuccess: refresh,
  })
  const release = useMutation({
    mutationFn: async () => {
      if (!status.data) throw new Error("Workspace index is not registered")
      return releaseRpc({ id: status.data.id, purge: status.data.kind === "worktree" })
    },
    onSuccess: () => {
      setConfirmRelease(false)
      return refresh()
    },
  })
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 16 : 24, gap: 14 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 21 : 25, fontWeight: "700" as const },
      subtitle: { color: theme.colors.foregroundMuted, fontSize: 13 },
      card: { borderWidth: 1, borderColor: theme.colors.foregroundMuted, borderRadius: 12, padding: 14, gap: 9 },
      row: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, gap: 10 },
      state: { color: theme.colors.accent, fontSize: 15, fontWeight: "700" as const },
      danger: { color: theme.colors.statusDanger, fontSize: 14 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 13 },
      progressTrack: { height: 7, borderRadius: 4, overflow: "hidden" as const, backgroundColor: theme.colors.foregroundMuted },
      progressFill: { height: 7, borderRadius: 4, backgroundColor: theme.colors.accent },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 9 },
      button: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 9, backgroundColor: theme.colors.accent },
      dangerButton: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 9, borderWidth: 1, borderColor: theme.colors.statusDanger },
      buttonText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      dangerText: { color: theme.colors.statusDanger, fontWeight: "600" as const },
      disabled: { opacity: 0.5 },
    }),
    [layout.compact, theme],
  )
  const pending = register.isPending || reindex.isPending || release.isPending
  const error = status.error ?? register.error ?? reindex.error ?? release.error

  if (!workspace) {
    return (
      <View style={styles.content}>
        <Text style={styles.danger}>Workspace information is unavailable.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.title}>{workspace.name}</Text>
        <Text style={styles.subtitle}>
          {(status.data?.kind ?? (workspace.kind === "worktree" ? "worktree" : "primary")) === "worktree"
            ? "Worktree overlay"
            : "Primary baseline"}
        </Text>
      </View>

      {status.isLoading ? <ActivityIndicator color={theme.colors.accent} accessibilityLabel="Loading workspace index" /> : null}
      {error ? <Text style={styles.danger}>{error.message}</Text> : null}

      {status.data ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.state}>{status.data.state}</Text>
            <Text style={styles.detail}>{status.data.percent}%</Text>
          </View>
          <Text style={styles.detail}>{status.data.message}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${status.data.percent}%` }]} />
          </View>
          <Text style={styles.detail}>
            {status.data.processedItems} / {status.data.totalItems} files
          </Text>
          {status.data.lastError ? <Text style={styles.danger}>{status.data.lastError}</Text> : null}
        </View>
      ) : !status.isLoading ? (
        <View style={styles.card}>
          <Text style={styles.detail}>This workspace is not registered with the semantic index service.</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {!status.data ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Register workspace semantic index"
            disabled={pending}
            onPress={() => register.mutate()}
            style={[styles.button, pending ? styles.disabled : null]}
          >
            <Text style={styles.buttonText}>Register index</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reindex workspace"
              disabled={pending}
              onPress={() => reindex.mutate()}
              style={[styles.button, pending ? styles.disabled : null]}
            >
              <Text style={styles.buttonText}>Reindex</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmRelease ? "Confirm release of workspace index" : "Release workspace index"}
              disabled={pending}
              onPress={() => (confirmRelease ? release.mutate() : setConfirmRelease(true))}
              style={[styles.dangerButton, pending ? styles.disabled : null]}
            >
              <Text style={styles.dangerText}>{confirmRelease ? "Confirm release" : "Release"}</Text>
            </Pressable>
            {confirmRelease ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel release"
                disabled={pending}
                onPress={() => setConfirmRelease(false)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  )
}
