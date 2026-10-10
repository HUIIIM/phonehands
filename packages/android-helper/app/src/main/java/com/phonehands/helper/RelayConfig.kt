// SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

package com.phonehands.helper

import android.content.Context
import androidx.core.content.edit

/**
 * Relay endpoint configuration.
 *
 * Single source of truth for where the phone dials:
 *   1. value typed in the setup UI (SharedPreferences), else
 *   2. [DEFAULT_RELAY_URL].
 *
 * The agent side reads the SAME URL from the PHONEHANDS_RELAY_URL environment
 * variable (see @phonehands/android-backend relay-url.ts). Keep them in sync:
 * whatever the phone dials, the agent must be listening on.
 *
 * Example relay URLs:
 *   ws://127.0.0.1:9011/phonehands-android        (local dev / mock)
 *   wss://relay.example.com:9011/phonehands-android (phone over the internet,
 *        agent's box reachable via SSH reverse tunnel or Tailscale)
 *
 * Security notes:
 *  - Use wss:// (TLS) whenever the phone leaves your LAN. Plain ws:// is
 *    acceptable only on loopback / trusted networks.
 *  - Set a relay token: the server rejects hello messages with a mismatched
 *    token. The token is never logged — only its presence/absence.
 */
object RelayConfig {
    fun getRelayUrl(context: Context): String =
        context.getSharedPreferences(AgentService.PREFS, Context.MODE_PRIVATE)
            .getString(AgentService.KEY_RELAY_URL, AgentService.DEFAULT_RELAY_URL)
            ?: AgentService.DEFAULT_RELAY_URL

    fun setRelayUrl(context: Context, url: String) {
        context.getSharedPreferences(AgentService.PREFS, Context.MODE_PRIVATE).edit {
            putString(AgentService.KEY_RELAY_URL, url)
        }
    }

    fun setToken(context: Context, token: String) {
        context.getSharedPreferences(AgentService.PREFS, Context.MODE_PRIVATE).edit {
            putString(AgentService.KEY_TOKEN, token)
        }
    }
}
