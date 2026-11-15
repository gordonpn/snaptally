# Saving and syncing transactions

A saved confirmation means SnapTally accepted the transaction into this browser's
outbox. The form clears the merchant, amount, date and credit mode, restores the
default category and most-used card, and immediately accepts the next entry.
Saved cards, merchant suggestions, currency, appearance and API settings remain
available.

Network synchronization continues separately. The pending badge and spinner show
its progress without disabling the keypad. Open Sync Status to inspect pending
items, retry failed items or review a server rejection. An authentication warning
means the API token needs attention in Settings; a saved confirmation alone does
not mean the server has accepted the transaction.

The outbox uses IndexedDB, with browser storage and memory fallbacks when storage
is unavailable. A memory-only queue does not survive closing or reloading the
page. Keep the page open until synchronization finishes when browser persistence
is restricted.

Submission feedback uses a short fade and smooth amount-display transitions.
Reduced-motion preferences disable these effects. Neither effect delays saving
or entering the next transaction.
