const [mode, marker] = process.argv.slice(2)
const input = await new Promise((resolve) => {
  const chunks = []
  process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
})
const response = JSON.parse(input)
const found = response.results?.some((result) => result.codeChunk.includes(marker)) ?? false
if ((mode === "contains" && !found) || (mode === "absent" && found)) {
  console.error(`Expected marker ${JSON.stringify(marker)} to be ${mode}; response was ${input}`)
  process.exit(1)
}
