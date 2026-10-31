const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// PayMesh derives agentId from the backend UUID: 16 bytes left-aligned in a bytes32.
const uuidToBytes32 = (uuid) => "0x" + uuid.replace(/-/g, "") + "00".repeat(16);
const cat = (s) => ethers.encodeBytes32String(s);
const AGENT = uuidToBytes32("123e4567-e89b-12d3-a456-426614174000");
const URI = "https://paymesh.example/agents/123e4567.json";

describe("AgentRegistry", () => {
  async function deploy() {
    const [owner, other, newOwner] = await ethers.getSigners();
    const registry = await (await ethers.getContractFactory("AgentRegistry")).deploy();
    return { registry, owner, other, newOwner };
  }

  describe("registration", () => {
    it("registers an agent, associates the caller as owner, emits an event", async () => {
      const { registry, owner } = await loadFixture(deploy);
      await expect(registry.connect(owner).registerAgent(AGENT, cat("crypto_research"), URI))
        .to.emit(registry, "AgentRegistered")
        .withArgs(AGENT, owner.address, cat("crypto_research"), URI);

      const a = await registry.getAgent(AGENT);
      expect(a.owner).to.equal(owner.address);
      expect(a.categoryId).to.equal(cat("crypto_research"));
      expect(a.metadataURI).to.equal(URI);
      expect(a.active).to.equal(true);
      expect(a.registeredAt).to.equal(BigInt(await time.latest()));
      expect(await registry.isRegistered(AGENT)).to.equal(true);
      expect(await registry.isActive(AGENT)).to.equal(true);
      expect(await registry.ownerOf(AGENT)).to.equal(owner.address);
      expect(await registry.agentCount()).to.equal(1n);
    });

    it("rejects duplicate ids, zero id, zero category and oversized metadata", async () => {
      const { registry, other } = await loadFixture(deploy);
      await registry.registerAgent(AGENT, cat("c"), URI);
      await expect(registry.connect(other).registerAgent(AGENT, cat("c"), URI))
        .to.be.revertedWithCustomError(registry, "AlreadyRegistered").withArgs(AGENT);
      await expect(registry.registerAgent(ethers.ZeroHash, cat("c"), URI)).to.be.revertedWithCustomError(registry, "InvalidAgentId");
      await expect(registry.registerAgent(uuidToBytes32("00000000-0000-0000-0000-000000000001"), ethers.ZeroHash, URI))
        .to.be.revertedWithCustomError(registry, "InvalidCategory");
      await expect(registry.registerAgent(uuidToBytes32("00000000-0000-0000-0000-000000000002"), cat("c"), "x".repeat(513)))
        .to.be.revertedWithCustomError(registry, "MetadataTooLong").withArgs(513, 512);
      await registry.registerAgent(uuidToBytes32("00000000-0000-0000-0000-000000000003"), cat("c"), "x".repeat(512)); // boundary ok
    });

    it("an existing id cannot be re-registered or taken over by another account", async () => {
      const { registry, owner, other } = await loadFixture(deploy);
      await registry.connect(owner).registerAgent(AGENT, cat("c"), URI);
      await expect(registry.connect(other).registerAgent(AGENT, cat("evil"), "evil")).to.be.reverted;
      expect(await registry.ownerOf(AGENT)).to.equal(owner.address);
    });
  });

  describe("management (owner only)", () => {
    async function registered() {
      const f = await deploy();
      await f.registry.connect(f.owner).registerAgent(AGENT, cat("crypto_research"), URI);
      return f;
    }

    it("updates metadata and emits", async () => {
      const { registry, owner } = await loadFixture(registered);
      await expect(registry.connect(owner).updateMetadata(AGENT, cat("market_data"), "ipfs://new"))
        .to.emit(registry, "AgentMetadataUpdated").withArgs(AGENT, cat("market_data"), "ipfs://new");
      const a = await registry.getAgent(AGENT);
      expect(a.categoryId).to.equal(cat("market_data"));
      expect(a.metadataURI).to.equal("ipfs://new");
    });

    it("toggles active/inactive and only emits on a real change", async () => {
      const { registry, owner } = await loadFixture(registered);
      await expect(registry.connect(owner).setActive(AGENT, false)).to.emit(registry, "AgentStatusChanged").withArgs(AGENT, false);
      expect(await registry.isActive(AGENT)).to.equal(false);
      await expect(registry.connect(owner).setActive(AGENT, false)).to.not.emit(registry, "AgentStatusChanged");
      await expect(registry.connect(owner).setActive(AGENT, true)).to.emit(registry, "AgentStatusChanged").withArgs(AGENT, true);
    });

    it("blocks non-owners from every mutating function", async () => {
      const { registry, other } = await loadFixture(registered);
      const r = registry.connect(other);
      await expect(r.updateMetadata(AGENT, cat("c"), "x")).to.be.revertedWithCustomError(registry, "NotAgentOwner").withArgs(AGENT, other.address);
      await expect(r.setActive(AGENT, false)).to.be.revertedWithCustomError(registry, "NotAgentOwner");
      await expect(r.transferAgentOwnership(AGENT, other.address)).to.be.revertedWithCustomError(registry, "NotAgentOwner");
    });

    it("reverts mutating calls on unknown agents", async () => {
      const { registry, owner } = await loadFixture(deploy);
      const ghost = uuidToBytes32("99999999-9999-9999-9999-999999999999");
      await expect(registry.connect(owner).setActive(ghost, true)).to.be.revertedWithCustomError(registry, "NotRegistered");
      await expect(registry.connect(owner).updateMetadata(ghost, cat("c"), "x")).to.be.revertedWithCustomError(registry, "NotRegistered");
    });

    it("transfers ownership; the old owner loses control, the zero address is refused", async () => {
      const { registry, owner, newOwner } = await loadFixture(registered);
      await expect(registry.connect(owner).transferAgentOwnership(AGENT, ethers.ZeroAddress)).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await expect(registry.connect(owner).transferAgentOwnership(AGENT, newOwner.address))
        .to.emit(registry, "AgentOwnershipTransferred").withArgs(AGENT, owner.address, newOwner.address);
      expect(await registry.ownerOf(AGENT)).to.equal(newOwner.address);
      await expect(registry.connect(owner).setActive(AGENT, false)).to.be.revertedWithCustomError(registry, "NotAgentOwner");
      await registry.connect(newOwner).setActive(AGENT, false);
    });
  });

  describe("views", () => {
    it("unknown agents: isRegistered=false, isActive=false, getAgent/ownerOf revert", async () => {
      const { registry } = await loadFixture(deploy);
      const ghost = uuidToBytes32("99999999-9999-9999-9999-999999999999");
      expect(await registry.isRegistered(ghost)).to.equal(false);
      expect(await registry.isActive(ghost)).to.equal(false);
      await expect(registry.getAgent(ghost)).to.be.revertedWithCustomError(registry, "NotRegistered");
      await expect(registry.ownerOf(ghost)).to.be.revertedWithCustomError(registry, "NotRegistered");
    });

    it("counts registrations", async () => {
      const { registry } = await loadFixture(deploy);
      for (let i = 1; i <= 3; i++) {
        await registry.registerAgent(uuidToBytes32(`00000000-0000-0000-0000-00000000000${i}`), cat("c"), URI);
      }
      expect(await registry.agentCount()).to.equal(3n);
    });
  });

  describe("safety properties", () => {
    it("holds no funds: rejects plain ETH/HSK transfers and payable calls", async () => {
      const { registry, owner } = await loadFixture(deploy);
      await expect(owner.sendTransaction({ to: await registry.getAddress(), value: 1n })).to.be.reverted;
      await expect(registry.registerAgent(AGENT, cat("c"), URI, { value: 1n })).to.be.reverted;
      expect(await ethers.provider.getBalance(await registry.getAddress())).to.equal(0n);
    });

    it("exposes no admin, pause, upgrade or payment functions", async () => {
      const { registry } = await loadFixture(deploy);
      const names = registry.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
      for (const banned of ["pause", "upgradeTo", "setAdmin", "withdraw", "pay", "transfer", "settle", "selfdestruct"]) {
        expect(names).to.not.include(banned);
      }
    });
  });
});
