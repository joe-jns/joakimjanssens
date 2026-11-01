import { describe, it, expect, beforeEach, vi } from "vitest";
import { emptyState } from "./model";
import { seal, open } from "./sync";

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};

import { state, update, reload, bus, refreshAuto, saveError } from "./store";

beforeEach(() => {
  mem.clear();
  reload();
});

describe("store", () => {
  it("état absent → emptyState", () => {
    expect(state.value).toEqual(emptyState());
  });

  it("JSON corrompu → emptyState, sans exception", () => {
    mem.set("argent:v2", "{pas du json");
    expect(() => reload()).not.toThrow();
    expect(state.value).toEqual(emptyState());
  });

  it("ancienne sauvegarde sans champs récents : complétée par les défauts", () => {
    const old: any = { ...emptyState() };
    delete old.dismissed;
    mem.set("argent:v2", JSON.stringify(old));
    reload();
    expect(state.value.dismissed).toEqual(emptyState().dismissed);
  });

  it("update écrit argent:v2 et émet argent:saved", () => {
    let n = 0;
    bus.addEventListener("argent:saved", () => n++);
    update((s) => ({ ...s, v: 2, debts: [] }));
    expect(JSON.parse(mem.get("argent:v2")!).v).toBe(2);
    expect(n).toBe(1);
  });

  it("mémoire pleine : l'erreur est signalée, puis effacée au prochain enregistrement réussi", () => {
    const ls = (globalThis as any).localStorage;
    const set = ls.setItem;
    ls.setItem = () => {
      throw new DOMException("plein", "QuotaExceededError");
    };
    try {
      update((s) => ({ ...s, dismissed: ["x"] }));
    } finally {
      ls.setItem = set;
    }
    expect(saveError.value).toMatch(/Mémoire du navigateur pleine/);
    update((s) => ({ ...s, dismissed: ["y"] }));
    expect(saveError.value).toBeNull();
  });

  it("refreshAuto ne plante pas sur un état vide", () => {
    expect(() => refreshAuto(new Date(2026, 9, 31))).not.toThrow();
  });
});

describe("chiffrement", () => {
  it("chiffrer puis déchiffrer redonne le même texte", async () => {
    const code = "abcd-efgh-jkmn-pqrs-tuvw";
    const blob = await seal(code, "Salut é€ 123");
    expect(blob).not.toContain("Salut");
    expect(await open(code, blob)).toBe("Salut é€ 123");
  });

  it("mauvais code → échec", async () => {
    const blob = await seal("abcd-efgh-jkmn-pqrs-tuvw", "x");
    await expect(open("zzzz-efgh-jkmn-pqrs-tuvw", blob)).rejects.toThrow();
  });
});

describe("synchro (réseau simulé)", () => {
  it("rejoindre : le distant gagne, le signal est rechargé", async () => {
    const sync = await import("./sync");
    const code = "abcd-efgh-jkmn-pqrs-tuvw";
    const remoteState = { ...emptyState(), dismissed: ["x"] };
    const data = await sync.seal(code, JSON.stringify({ "argent:v2": JSON.stringify(remoteState) }));
    sync.deps.fetch = (async () => new Response(JSON.stringify({ v: 5, data }), { status: 200 })) as any;
    await sync.joinSync(code);
    expect(state.value.dismissed).toEqual(["x"]);
    expect(JSON.parse(mem.get("argent:sync:v2")!).synced).toBe(5);
  });

  it("code trop court refusé", async () => {
    const sync = await import("./sync");
    await sync.joinSync("abc");
    expect(sync.syncStatus.value.message).toMatch(/trop court/);
  });
});

describe("synchro : aucune modification perdue", () => {
  const code = "abcd-efgh-jkmn-pqrs-tuvw";
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  const sealState = (c: string, s: object) =>
    import("./sync").then((m) => m.seal(c, JSON.stringify({ "argent:v2": JSON.stringify(s) })));
  const tick = () => new Promise((r) => setTimeout(r, 5));

  beforeEach(async () => {
    const sync = await import("./sync");
    sync.stopSync();
    sync.deps.debounce = 0;
    sync.attachBus();
  });

  it("404 puis envoi (base 0)", async () => {
    const sync = await import("./sync");
    const calls: any[] = [];
    sync.deps.fetch = (async (_u: string, init?: any) => {
      calls.push(init?.method ?? "GET");
      if (!init?.method) return new Response("", { status: 404 });
      calls.push(JSON.parse(init.body));
      return json({ ok: true });
    }) as any;
    await sync.enableSync();
    expect(calls[0]).toBe("GET");
    expect(calls[1]).toBe("POST");
    expect(calls[2].base).toBe(0);
    expect(JSON.parse(mem.get("argent:sync:v2:dirty")!)).toBe(false);
  });

  it("409 puis reprise du distant, avec message si des changements locaux sont écrasés", async () => {
    const sync = await import("./sync");
    const remote = { ...emptyState(), dismissed: ["distant"] };
    const data = await sealState(code, remote);
    sync.deps.fetch = (async () => json({ v: 1, data })) as any;
    await sync.joinSync(code);
    const data2 = await sealState(code, { ...emptyState(), dismissed: ["distant2"] });
    sync.deps.fetch = (async (_u: string, init?: any) => {
      if (!init?.method) return json({ v: 1, data }); // même version : rien à reprendre
      return json({ v: 9, data: data2 }, 409);
    }) as any;
    sync.deps.debounce = 60000; // pas d'envoi automatique : on déclenche la synchro à la main
    update((s) => ({ ...s, dismissed: ["local"] })); // édition locale non envoyée
    await sync.syncNow();
    sync.deps.debounce = 0;
    expect(state.value.dismissed).toEqual(["distant2"]);
    expect(sync.syncStatus.value.message).toMatch(/autre appareil/);
  });

  it("mauvais code : les données locales ne bougent pas", async () => {
    const sync = await import("./sync");
    update((s) => ({ ...s, dismissed: ["a-moi"] }));
    const before = mem.get("argent:v2");
    const data = await sealState("zzzz-efgh-jkmn-pqrs-tuvw", { ...emptyState(), dismissed: ["autre"] });
    sync.deps.fetch = (async () => json({ v: 3, data })) as any;
    await sync.joinSync(code);
    expect(mem.get("argent:v2")).toBe(before);
    expect(state.value.dismissed).toEqual(["a-moi"]);
    expect(sync.syncStatus.value.message).toBe("Code incorrect.");
    expect(sync.syncStatus.value.enabled).toBe(false);
  });

  it("une édition pendant l'envoi déclenche un second envoi avec les nouvelles données", async () => {
    const sync = await import("./sync");
    const posts: any[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    sync.deps.fetch = (async (_u: string, init?: any) => {
      if (!init?.method) return new Response("", { status: 404 });
      posts.push(JSON.parse(init.body));
      if (posts.length === 1) await gate;
      return json({ ok: true });
    }) as any;
    const p = sync.enableSync();
    while (posts.length < 1) await tick();
    update((s) => ({ ...s, dismissed: ["pendant-l-envoi"] }));
    release();
    await p;
    for (let i = 0; i < 50 && posts.length < 2; i++) await tick();
    expect(posts.length).toBe(2);
    const code2 = JSON.parse(mem.get("argent:sync:v2")!).code;
    const plain = JSON.parse(await sync.open(code2, posts[1].data));
    expect(JSON.parse(plain["argent:v2"]).dismissed).toEqual(["pendant-l-envoi"]);
    await tick();
    expect(JSON.parse(mem.get("argent:sync:v2:dirty")!)).toBe(false);
  });

  it("forme invalide : un tableau absent reprend son défaut", () => {
    mem.set("argent:v2", JSON.stringify({ ...emptyState(), txns: "oups", work: { skipped: 3 } }));
    reload();
    expect(state.value.txns).toEqual([]);
    expect(state.value.work.skipped).toEqual([]);
  });
});


describe("synchro v2 : espace à part, données d'une autre version refusées", () => {
  const code = "abcd-efgh-jkmn-pqrs-tuvw";
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const txn = (id: string, extra: object = {}) => ({
    id, accountId: "cbc", date: "2026-10-20", amount: -5, label: id, status: "manuel", source: "saisie", ...extra,
  });

  beforeEach(async () => {
    const sync = await import("./sync");
    sync.stopSync();
    sync.deps.debounce = 0;
    sync.attachBus();
  });

  it("identifiant serveur et réglages propres à la v2", async () => {
    const sync = await import("./sync");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`argent-id-v2:${code}`));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect((await sync.deriveKey(code)).id).toBe(hex);
    const urls: string[] = [];
    sync.deps.fetch = (async (u: string, init?: any) => {
      urls.push(u);
      return init?.method ? json({ ok: true }) : new Response("", { status: 404 });
    }) as any;
    await sync.enableSync();
    expect(mem.has("argent:sync:v2")).toBe(true);
    expect(mem.has("argent:sync")).toBe(false);
    expect(urls.every((u) => /id=[a-f0-9]{64}$/.test(u))).toBe(true);
  });

  it("rejoindre un espace qui contient des données v1 : rien n'est effacé ni activé", async () => {
    const sync = await import("./sync");
    update((s) => ({ ...s, dismissed: ["a-moi"] }));
    const before = mem.get("argent:v2");
    const data = await sync.seal(code, JSON.stringify({ argent: JSON.stringify({ old: true }) }));
    sync.deps.fetch = (async () => json({ v: 4, data })) as any;
    await sync.joinSync(code);
    expect(mem.get("argent:v2")).toBe(before);
    expect(state.value.dismissed).toEqual(["a-moi"]);
    expect(sync.syncStatus.value.message).toBe("Données d’une autre version ignorées.");
    expect(sync.syncStatus.value.enabled).toBe(false);
  });

  it("synchro en cours : un bloc distant sans argent:v2 ne supprime aucune clé locale", async () => {
    const sync = await import("./sync");
    const good = await sync.seal(code, JSON.stringify({ "argent:v2": JSON.stringify({ ...emptyState(), dismissed: ["distant"] }) }));
    sync.deps.fetch = (async () => json({ v: 1, data: good })) as any;
    await sync.joinSync(code);
    const before = mem.get("argent:v2");
    const bad = await sync.seal(code, JSON.stringify({ "argent:v2": null }));
    let posts = 0;
    sync.deps.fetch = (async (_u: string, init?: any) => {
      if (init?.method) posts++;
      return json({ v: 7, data: bad });
    }) as any;
    await sync.syncNow();
    expect(mem.get("argent:v2")).toBe(before);
    expect(posts).toBe(0);
    expect(sync.syncStatus.value.message).toBe("Données d’une autre version ignorées.");
    expect(JSON.parse(mem.get("argent:sync:v2")!).synced).toBe(1);
  });

  it("arrêter la synchro pendant une réception : aucune config recréée, données d'ici intactes", async () => {
    const sync = await import("./sync");
    const good = await sync.seal(code, JSON.stringify({ "argent:v2": JSON.stringify(emptyState()) }));
    sync.deps.fetch = (async () => json({ v: 1, data: good })) as any;
    await sync.joinSync(code);
    sync.deps.debounce = 60000;
    update((s) => ({ ...s, dismissed: ["ici"] }));
    sync.deps.debounce = 0;
    const before = mem.get("argent:v2");
    const other = await sync.seal(code, JSON.stringify({ "argent:v2": JSON.stringify({ ...emptyState(), dismissed: ["la-bas"] }) }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    sync.deps.fetch = (async () => json({ v: 5, data: other })) as any;
    // Le déchiffrement attend : on arrête la synchro pendant ce temps.
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...a: any[]) => (await gate, decrypt(...(a as [any, any, any]))));
    const p = sync.syncNow();
    await tick();
    sync.stopSync();
    release();
    await p;
    spy.mockRestore();
    await tick();
    expect(sync.syncStatus.value.message).toMatch(/arrêtée/);
    expect(mem.has("argent:sync:v2")).toBe(false);
    expect(sync.syncStatus.value.enabled).toBe(false);
    expect(mem.get("argent:v2")).toBe(before);
  });

  it("arrêter la synchro pendant la lecture d'un refus (409) : aucune config recréée", async () => {
    const sync = await import("./sync");
    const other = await sync.seal(code, JSON.stringify({ "argent:v2": JSON.stringify({ ...emptyState(), dismissed: ["la-bas"] }) }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    sync.deps.fetch = (async (_u: string, init?: any) => {
      if (!init?.method) return new Response("", { status: 404 });
      return { status: 409, ok: false, json: async () => (await gate, { v: 5, data: other }) };
    }) as any;
    const p = sync.enableSync();
    await tick();
    sync.stopSync();
    release();
    await p;
    await tick();
    expect(sync.syncStatus.value.message).toMatch(/arrêtée/);
    expect(mem.has("argent:sync:v2")).toBe(false);
    expect(state.value.dismissed).toEqual([]);
  });

  it("espace vidé côté serveur (409 sans données) : renvoi avec base 0", async () => {
    const sync = await import("./sync");
    const good = await sync.seal(code, JSON.stringify({ "argent:v2": JSON.stringify(emptyState()) }));
    sync.deps.fetch = (async () => json({ v: 3, data: good })) as any;
    await sync.joinSync(code);
    const bases: number[] = [];
    sync.deps.fetch = (async (_u: string, init?: any) => {
      if (!init?.method) return new Response("", { status: 404 });
      const b = JSON.parse(init.body).base;
      bases.push(b);
      return b === 0 ? json({ ok: true }) : json({ v: 0 }, 409);
    }) as any;
    await sync.syncNow();
    expect(bases).toEqual([3, 0]);
    expect(JSON.parse(mem.get("argent:sync:v2:dirty")!)).toBe(false);
  });

  it("une saisie faite ici depuis la dernière synchro survit à la reprise du distant, puis part", async () => {
    const sync = await import("./sync");
    const old = txn("ancienne");
    const start = await sync.seal(code, JSON.stringify({ "argent:v2": JSON.stringify({ ...emptyState(), txns: [old] }) }));
    sync.deps.fetch = (async () => json({ v: 1, data: start })) as any;
    await sync.joinSync(code);
    expect(state.value.txns.map((t) => t.id)).toEqual(["ancienne"]);

    // L'autre appareil a supprimé « ancienne » et ajouté « la-bas » ; ici on saisit « nouvelle ».
    const remote = await sync.seal(code, JSON.stringify({ "argent:v2": JSON.stringify({ ...emptyState(), txns: [txn("la-bas")] }) }));
    const posts: any[] = [];
    let v = 2;
    sync.deps.fetch = (async (_u: string, init?: any) => {
      if (!init?.method) return json({ v, data: remote });
      const body = JSON.parse(init.body);
      posts.push(body);
      if (body.base !== v) return json({ v, data: remote }, 409);
      v = body.v;
      return json({ v });
    }) as any;
    sync.deps.debounce = 60000;
    update((s) => ({ ...s, txns: [...s.txns, txn("nouvelle") as any] }));
    await sync.syncNow();
    sync.deps.debounce = 0;
    for (let i = 0; i < 50 && !posts.length; i++) await tick();

    expect(state.value.txns.map((t) => t.id).sort()).toEqual(["la-bas", "nouvelle"]);
    expect(posts.length).toBeGreaterThan(0);
    const sent = JSON.parse(JSON.parse(await sync.open(code, posts.at(-1).data))["argent:v2"]);
    expect(sent.txns.map((t: any) => t.id).sort()).toEqual(["la-bas", "nouvelle"]);
    expect(posts.at(-1).base).toBe(2);
    await tick();
    expect(JSON.parse(mem.get("argent:sync:v2:pending") ?? "[]")).toEqual([]);
  });
});
