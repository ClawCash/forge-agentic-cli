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

// Matches IdentityRegistryUpgradeable, the reference implementation.
export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)",
])
