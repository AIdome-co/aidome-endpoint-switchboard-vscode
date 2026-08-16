# GitHub Copilot provider evidence

GitHub Copilot is a Tier B integration. The Switchboard can configure the
undocumented proxy override when the installed Copilot build registers the
setting. If the setting is not registered, it emits guided `settings.json`
instructions. It does not claim to configure Copilot BYOK providers or API keys.

## Upstream record

- Archived upstream repository: [microsoft/vscode-copilot-chat](https://github.com/microsoft/vscode-copilot-chat)
- Active upstream after the move: [microsoft/vscode](https://github.com/microsoft/vscode)
- Local upstream checkout: `microsoft/vscode-copilot-chat`, commit `5863f5a7088958050792b5dccbe8b46c6e13eccc`, package version `0.44.0`, dated 2026-05-20.
- Archive notice: active development moved into the main VS Code repository; future compatibility must be checked against VS Code as well as the archived source.

## Source trace

The first and second validation passes inspected these upstream files:

- [`configurationService.ts`](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/platform/configuration/common/configurationService.ts): defines `ConfigKey.Shared.DebugOverrideProxyUrl` as `advanced.debug.overrideProxyUrl` and qualifies it as `github.copilot.advanced.debug.overrideProxyUrl`.
- [`domainServiceImpl.ts`](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/platform/endpoint/node/domainServiceImpl.ts): reads the legacy setting, removes one trailing slash, and uses it as the Copilot proxy endpoint when domains are updated.
- [`config.ts`](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/extension/completions-core/vscode-node/lib/src/config.ts): recognizes the newer `internal.completionsUrl` key and the legacy `advanced.debug.overrideProxyUrl` fallback.
- [`networkConfiguration.ts`](https://github.com/microsoft/vscode-copilot-chat/blob/main/src/extension/completions-core/vscode-node/lib/src/networkConfiguration.ts): selects the current internal override first and the legacy override second for completion endpoint URLs.
- [`package.json`](https://github.com/microsoft/vscode-copilot-chat/blob/main/package.json): exposes language-model provider contributions and the separate BYOK/custom endpoint configuration surface; this is not the proxy-override setting.
- [`README.md` archive notice](https://github.com/microsoft/vscode-copilot-chat/blob/main/README.md): records the repository move to VS Code.

## Behavior and discrepancy notes

The official [GitHub Copilot network settings](https://docs.github.com/en/copilot/concepts/network-settings)
document standard HTTP proxy configuration, not `debug.overrideProxyUrl`. The
override is therefore treated as an internal compatibility surface, not a
documented public API. The source still reads it in the archived checkout, so
the adapter keeps the supported Tier B automatic path while validating its
value and providing a guided fallback when VS Code rejects an unregistered key.

Current [VS Code language model documentation](https://code.visualstudio.com/docs/agent-customization/language-models)
supports BYOK and a Custom Endpoint provider for Chat, including self-hosted
and enterprise endpoints. This is separate from Copilot's first-party proxy
domain override: BYOK is configured through **Chat: Manage Language Models**
and `chatLanguageModels.json`, and BYOK models do not provide inline
suggestions. The Switchboard deliberately leaves that provider data and all
credentials untouched.

The adapter verifies that the override exists as a string with an allowed
HTTP(S) URL. The shared endpoint verifier remains responsible for gateway
reachability, authentication, model inventory, and dialect checks; a local
setting check alone does not prove an assistant request succeeded.
