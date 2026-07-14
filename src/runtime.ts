import type { Config } from "./config.js";
import { MockProvider } from "./providers/mock-provider.js";
import type { RewardPaymentProvider } from "./providers/provider.js";
import { TalerWalletCliProvider } from "./providers/taler-wallet-cli-provider.js";

export function providerFor(config: Config): RewardPaymentProvider {
  return config.PROVIDER === "taler-wallet-cli"
    ? new TalerWalletCliProvider(config)
    : new MockProvider();
}
