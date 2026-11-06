import { type Address, parseAbi } from "viem"

// ERC-8004 registries on Arc testnet.
// https://docs.arc.io/arc/references/contract-addresses#erc-8004
export const ARC_TESTNET_REGISTRIES = {
  chainId: 5042002,
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
}

// The registry reference used in registration files: {namespace}:{chainId}:{address}.
export const ARC_TESTNET_IDENTITY_REGISTRY = `eip155:${ARC_TESTNET_REGISTRIES.chainId}:${ARC_TESTNET_REGISTRIES.identity}`

// Checked against IdentityRegistryUpgradeable, verified on explorer.testnet.arc.io.
export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  "event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)",
])
