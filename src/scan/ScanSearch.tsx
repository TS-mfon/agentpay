"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { normalizeScanId } from "./scan-client";

export default function ScanSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = normalizeScanId(value);
    if (!id) {
      setInvalid(true);
      return;
    }
    router.push("/scan/" + id);
  }

  return (
    <form className="scan-search" onSubmit={submit} noValidate>
      <label htmlFor="scan-lookup">Paste a request ID</label>
      <div className="scan-search-row">
        <div className="scan-search-input">
          <Search size={20} aria-hidden="true" />
          <input
            id="scan-lookup"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            placeholder="0x…"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setInvalid(false);
            }}
            aria-invalid={invalid}
            aria-describedby={invalid ? "scan-lookup-error" : undefined}
          />
        </div>
        <button className="scan-button" type="submit">Find request</button>
      </div>
      {invalid && <p id="scan-lookup-error" className="scan-feedback" role="alert">Enter a full AgentPay request ID.</p>}
    </form>
  );
}
