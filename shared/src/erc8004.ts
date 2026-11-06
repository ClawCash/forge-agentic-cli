import { type Address, parseAbi } from "viem"

// ERC-8004 registries on Hedera testnet (chain 296), at the same addresses as
// the reference deployments on other chains.
export const HEDERA_TESTNET_REGISTRIES = {
  chainId: 296,
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
}

// The registry reference used in registration files: {namespace}:{chainId}:{address}.
export const HEDERA_TESTNET_IDENTITY_REGISTRY = `eip155:${HEDERA_TESTNET_REGISTRIES.chainId}:${HEDERA_TESTNET_REGISTRIES.identity}`

// Matches ReputationRegistryUpgradeable, the reference implementation (the same
// implementation, 0x16e0…dA34, sits behind the proxy on Hedera testnet).
export const reputationRegistryAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
])

// Review outcomes and the score each writes onchain (valueDecimals 0).
export const OUTCOME_VALUES = { success: 100, partial: 50, failure: 0 } as const
export type Outcome = keyof typeof OUTCOME_VALUES

// Matches IdentityRegistryUpgradeable, the reference implementation.
export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)",
])
