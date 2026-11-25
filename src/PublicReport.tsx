import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, TriangleAlert } from "lucide-react";
import { apiBase } from "./cloud";
type VehicleOption = { id: string; label: string; plate: string; kind: string };
export function PublicReport() {
  const [token, setToken] = useState(() => window.location.hash.slice(1)),
    [vehicles, setVehicles] = useState<VehicleOption[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState("");
  const [form, setForm] = useState({
      vehicleId: "",
      kind: "fault",
      insuranceCase: false,
      description: "",
      severity: "minor",
      immobilize: false,
      reporterName: "",
      website: "",
    }),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  const camera = useRef<HTMLInputElement>(null),
    gallery = useRef<HTMLInputElement>(null),
    requestKey = useRef(crypto.randomUUID());
  const request = async (path: string, body?: unknown) => {
    const r = await fetch(apiBase + "/reporting/" + path, {
      headers: {
        "X-Report-Token": token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error ?? "Hlášení se nepodařilo odeslat.");
    return b;
  };
  useEffect(() => {
    const changed = () => setToken(window.location.hash.slice(1));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setVehicles([]);
    setError("");
    setReceipt("");
    document.title = "Nahlásit závadu · Autoškola BuBu";
    request("vehicles")
      .then((b) => {
        if (cancelled) return;
        setVehicles(b.vehicles);
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const set = (key: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));
  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (
      !["image/jpeg", "image/png"].includes(f.type) ||
      f.size > 5 * 1024 * 1024
    ) {
      setError("Vyberte fotografii JPG nebo PNG do 5 MB.");
      return;
    }
    setFile(f);
    setError("");
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const photo = file
        ? {
            name: file.name,
            mime: file.type,
            data: await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(String(reader.result).split(",")[1]);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            }),
          }
        : undefined;
      const result = await request("submit", {
        ...form,
        requestKey: requestKey.current,
        photo,
      });
      setReceipt(result.receipt);
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="public-report">
      <header>
        <img
          src="/brand/bubu-logo.png"
          width="588"
          height="217"
          alt="Autoškola BuBu"
        />
      </header>
      <main className="public-report-content">
        {receipt ? (
          <section className="public-report-success">
            <CheckCircle2 size={42} />
            <h1>Hlášení přijato</h1>
            <p>Hlášení je uložené pro správce vozidel.</p>
            {(form.severity === "serious" || form.kind === "accident") && (
              <p className="public-report-warning">
                Vážnou závadu nebo nehodu ihned oznamte správci. Nebezpečné
                vozidlo nepoužívejte.
              </p>
            )}
            <small>Potvrzení: {receipt}</small>
            <button
              className="button primary"
              onClick={() => {
                setReceipt("");
                requestKey.current = crypto.randomUUID();
                setForm({
                  vehicleId: "",
                  kind: "fault",
                  insuranceCase: false,
                  description: "",
                  severity: "minor",
                  immobilize: false,
                  reporterName: "",
                  website: "",
                });
              }}
            >
              Nahlásit další závadu
            </button>
          </section>
        ) : (
          <>
            <h1>Nahlásit závadu</h1>
            <p className="public-report-intro">
              Vyberte vozidlo a popište problém. Přihlášení není potřeba.
            </p>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            {loaded && (
              <form onSubmit={submit}>
                <label>
                  Vozidlo
                  <select
                    aria-label="Vozidlo"
                    required
                    value={form.vehicleId}
                    onChange={(e) => set("vehicleId", e.target.value)}
                  >
                    <option value="">Vyberte vozidlo</option>
                    {[
                      ["car", "Auto"],
                      ["motorcycle", "Moto"],
                      ["trailer", "Přívěsy"],
                    ].map(([kind, label]) => (
                      <optgroup key={kind} label={label}>
                        {vehicles
                          .filter((v) => v.kind === kind)
                          .map((v) => (
                            <option value={v.id} key={v.id}>
                              {v.label} · {v.plate}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <div className="public-report-row">
                  <label>
                    Typ hlášení
                    <select
                      value={form.kind}
                      onChange={(e) => set("kind", e.target.value)}
                    >
                      <option value="fault">Závada</option>
                      <option value="accident">Nehoda</option>
                    </select>
                  </label>
                  <label>
                    Závažnost
                    <select
                      value={form.severity}
                      onChange={(e) => {
                        set("severity", e.target.value);
                        if (e.target.value !== "serious")
                          set("immobilize", false);
                      }}
                    >
                      <option value="minor">Běžná závada</option>
                      <option value="serious">Vážné / nebezpečné</option>
                    </select>
                  </label>
                </div>
                <label>
                  Popis závady nebo nehody
                  <textarea
                    required
                    minLength={5}
                    maxLength={3000}
                    rows={5}
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </label>
                {form.severity === "serious" && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.immobilize}
                      onChange={(e) => set("immobilize", e.target.checked)}
                    />
                    Označit vozidlo za nepoužitelné
                  </label>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.insuranceCase}
                    onChange={(e) => set("insuranceCase", e.target.checked)}
                  />
                  Souvisí s pojistnou událostí
                </label>
                <label>
                  Vaše jméno
                  <input
                    required
                    maxLength={100}
                    autoComplete="name"
                    value={form.reporterName}
                    onChange={(e) => set("reporterName", e.target.value)}
                  />
                </label>
                <div className="public-photo">
                  <span>Fotografie (nepovinná)</span>
                  <div className="photo-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => gallery.current?.click()}
                    >
                      Vybrat fotografii
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => camera.current?.click()}
                    >
                      <Camera size={18} />
                      Vyfotit
                    </button>
                  </div>
                  <input
                    ref={gallery}
                    className="camera-input"
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={choose}
                    aria-label="Vybrat fotografii"
                  />
                  <input
                    ref={camera}
                    className="camera-input"
                    type="file"
                    accept="image/jpeg,image/png"
                    capture="environment"
                    onChange={choose}
                    aria-label="Fotoaparát"
                  />
                  {preview && (
                    <>
                      <img
                        className="attachment-preview"
                        src={preview}
                        alt="Náhled fotografie"
                      />
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setFile(null)}
                      >
                        Odebrat fotografii
                      </button>
                    </>
                  )}
                  <small>JPG nebo PNG · nejvýše 5 MB</small>
                </div>
                {(form.severity === "serious" || form.kind === "accident") && (
                  <div className="public-report-warning">
                    <TriangleAlert size={20} />
                    <p>
                      Nebezpečné vozidlo nepoužívejte. Vážnou závadu nebo nehodu
                      ihned oznamte správci.
                    </p>
                  </div>
                )}
                <label className="report-honeypot" aria-hidden="true">
                  Web
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    value={form.website}
                    onChange={(e) => set("website", e.target.value)}
                  />
                </label>
                <button
                  className="button primary public-report-submit"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? "Odesílání…" : "Odeslat hlášení"}
                </button>
              </form>
            )}
          </>
        )}
      </main>
      <footer>Autoškola BuBu · Hlášení závad vozidel</footer>
    </div>
  );
}
