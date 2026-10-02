import type { Config } from "./config.js";
import { MockProvider } from "./providers/mock-provider.js";
import type { RewardPaymentProvider } from "./providers/provider.js";
import { TalerWalletCliProvider } from "./providers/taler-wallet-cli-provider.js";
import { TalerWalletRpcProvider } from "./providers/taler-wallet-rpc-provider.js";

export function providerFor(config: Config): RewardPaymentProvider {
  switch (config.PROVIDER) {
    case "taler-wallet-rpc":
      return new TalerWalletRpcProvider({
        TALER_WALLET_CONNECTION: config.TALER_WALLET_CONNECTION ?? "",
        TALER_WALLET_COMMAND_TIMEOUT_MS: config.TALER_WALLET_COMMAND_TIMEOUT_MS,
        TALER_EXCHANGE_BASE_URL: config.TALER_EXCHANGE_BASE_URL,
      });
    case "taler-wallet-cli":
      return new TalerWalletCliProvider(config);
    default:
      return new MockProvider();
  }
}
