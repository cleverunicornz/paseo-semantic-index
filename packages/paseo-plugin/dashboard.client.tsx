import { useQuery } from "@tanstack/react-query"
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin"
import React, { useMemo } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native"
import { serviceStatusRpc } from "./rpc.shared"

function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function Dashboard({ theme, layout, host }: PluginSurfaceProps) {
  const statusRpc = useRpc(serviceStatusRpc)
  const status = useQuery({
    queryKey: ["semantic-index", "status"],
    queryFn: () => statusRpc({}),
    refetchInterval: 2_000,
  })
  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      content: {
        padding: layout.compact ? 16 : 24,
        gap: layout.compact ? 14 : 18,
      },
      header: { gap: 5 },
      title: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 24 : 30,
        fontWeight: "700" as const,
      },
      subtitle: { color: theme.colors.foregroundMuted, fontSize: 14 },
      summary: {
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        gap: 10,
      },
      metric: {
        flex: 1,
        minWidth: 130,
        padding: 14,
        borderRadius: 12,
        backgroundColor: theme.colors.accent,
        gap: 4,
      },
      metricValue: { color: theme.colors.accentForeground, fontSize: 24, fontWeight: "700" as const },
      metricLabel: { color: theme.colors.accentForeground, fontSize: 12 },
      sectionTitle: { color: theme.colors.foreground, fontSize: 18, fontWeight: "600" as const },
      card: {
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        gap: 8,
      },
      row: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: 12 },
      name: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const, flex: 1 },
      state: { color: theme.colors.accent, fontSize: 13, fontWeight: "600" as const },
      danger: { color: theme.colors.statusDanger, fontSize: 13, fontWeight: "600" as const },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
      progressTrack: {
        height: 6,
        borderRadius: 3,
        overflow: "hidden" as const,
        backgroundColor: theme.colors.foregroundMuted,
      },
      progressFill: { height: 6, borderRadius: 3, backgroundColor: theme.colors.accent },
      button: { alignSelf: "flex-start" as const, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      error: { color: theme.colors.statusDanger, fontSize: 14 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 14 },
    }),
    [layout.compact, theme],
  )

  const data = status.data
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Semantic index</Text>
        <Text style={styles.subtitle}>{host.label}</Text>
        <Text style={styles.subtitle}>{data?.message ?? "Reading plugin status..."}</Text>
      </View>

      {status.isLoading ? <ActivityIndicator color={theme.colors.accent} accessibilityLabel="Loading index status" /> : null}
      {status.error ? <Text style={styles.error}>{status.error.message}</Text> : null}

      {data ? (
        <>
          <View style={styles.summary}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{label(data.phase)}</Text>
              <Text style={styles.metricLabel}>Service</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{data.activeManagers}</Text>
              <Text style={styles.metricLabel}>Active indexes</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{data.mcpSessions}</Text>
              <Text style={styles.metricLabel}>MCP sessions</Text>
            </View>
          </View>

          <View style={styles.row}>
            <Text style={styles.sectionTitle}>Registered workspaces</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh semantic index status"
              onPress={() => void status.refetch()}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Refresh</Text>
            </Pressable>
          </View>

          {data.registrations.length === 0 ? (
            <Text style={styles.empty}>No projects or worktrees are registered on this daemon.</Text>
          ) : (
            data.registrations.map((registration) => (
              <View key={registration.id} style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.name}>{registration.id}</Text>
                  <Text style={registration.state === "Error" ? styles.danger : styles.state}>
                    {registration.state}
                  </Text>
                </View>
                <Text style={styles.detail}>{registration.kind === "primary" ? "Primary baseline" : "Worktree overlay"}</Text>
                <Text style={styles.detail}>{registration.message}</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${registration.percent}%` }]} />
                </View>
                <Text style={styles.detail}>
                  {registration.processedItems} / {registration.totalItems} files, {registration.percent}%
                </Text>
                {registration.lastError ? <Text style={styles.error}>{registration.lastError}</Text> : null}
              </View>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  )
}
