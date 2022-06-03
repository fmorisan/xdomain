interface NetworkData {
  TeleportJoin: string;
  domains: string[];
}

//Optimism
const KOVAN_TESTNET_DATA: NetworkData = {
  TeleportJoin: "0x556D9076A42Bba1892E3F4cA331daE587185Cef9",
  domains: ["0x4b4f56414e2d534c4156452d4f5054494d49534d2d3100000000000000000000"],
};

//Arbitrum
const RINKEBY_TESTNET_DATA: NetworkData = {
  TeleportJoin: "0x894DB23D804c626f1aAA89a2Bc3280052e6c4750",
  domains: ["0x52494e4b4542592d534c4156452d415242495452554d2d310000000000000000"],
};

export const NETWORK_MAP: Record<number, NetworkData> = {
  42: KOVAN_TESTNET_DATA,
  4: RINKEBY_TESTNET_DATA,
};

export default class NetworkManager implements NetworkData {
  public TeleportJoin: string;
  public domains: string[];
  networkMap: Record<number, NetworkData>;

  constructor(networkMap: Record<number, NetworkData>) {
    this.TeleportJoin = "0x0000000000000000000000000000000000000000";
    this.domains = ["0x0000000000000000000000000000000000000000000000000000000000000000"];
    this.networkMap = networkMap;
  }

  public setNetwork(networkId: number) {
    try {
      const { TeleportJoin, domains } = this.networkMap[networkId];
      this.TeleportJoin = TeleportJoin;
      this.domains = domains;
    } catch {
      throw new Error("You are running the bot on a non supported network");
    }
  }
}
