export function intakeForm() {
  return {
    amount: "",
    card: "",
    category: "",
    merchant: "",
    loading: false,
    statusMessage: "",
    isError: false,

    async submitTransaction() {
      this.loading = true;
      this.statusMessage = "Submitting transaction...";
      this.isError = false;

      const today = new Date().toISOString().slice(0, 10);
      const payload = {
        date: today,
        card: this.card,
        parent_bucket: "Variable",
        subcategory: this.category,
        merchant: this.merchant,
        gross_amount: parseFloat(this.amount),
        reimbursement: 0.0,
      };

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token =
        typeof localStorage !== "undefined" ? localStorage.getItem("snaptally_api_token") : null;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      try {
        const response = await fetch("/api/transactions", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => null);
        if (response.status === 201 && data?.ok) {
          this.statusMessage = `Transaction saved. ID: ${data.id}`;
          this.amount = "";
          this.card = "";
          this.category = "";
          this.merchant = "";
        } else {
          this.isError = true;
          this.statusMessage = `Error: ${data?.error || response.statusText}`;
        }
      } catch {
        this.isError = true;
        this.statusMessage = "Network error: Unable to reach endpoint";
      } finally {
        this.loading = false;
      }
    },
  };
}
