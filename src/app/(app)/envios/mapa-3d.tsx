"use client";

import { useEffect, useRef } from "react";
import type { MapaNaEstrada, PontoNaEstrada } from "@/lib/envios/mapa";
import mapaBrasil from "@/lib/envios/mapa-brasil.json";
import { CORES_TV, alturaDaColuna, corDaCidade, impressaoDaEstrada, para3d, rotulosDaTv, textoDoRotulo, totalDoPonto } from "@/lib/envios/tv-regra";

/**
 * O MAPA 3D DO MODO TV (RN-104): o Brasil à noite, visto de cima e um pouco
 * de lado, com uma coluna de luz por cidade que tem pacote a caminho (altura
 * = quantos), um arco da loja até cada cidade com uma luz viajando por ele
 * (é o que faz a tela parecer viva) e a cor dizendo a situação — cobre no
 * prazo, vermelho atrasado, âmbar parado (a régua da RN-102/RN-103).
 *
 * O three.js é carregado SÓ quando a TV abre (`import("three")` — a tela
 * Envios não paga os 600 KB), a cena é refeita quando os dados mudam (a cada
 * minuto, pela porta leve) e tudo é descartado ao fechar. Sem WebGL, o
 * componente diz e a TV segue com o placar e a lista.
 */

type Three = typeof import("three");

const UFS = (mapaBrasil as { ufs: Record<string, { d: string; centro: number[] }> }).ufs;
const PLACA = 5;

/** os contornos do SVG viram formas do three (só M, L e Z — é o que o gerador escreve) */
function formasDoEstado(THREE: Three, d: string) {
  const out: InstanceType<Three["Shape"]>[] = [];
  let atual: InstanceType<Three["Shape"]> | null = null;
  const re = /([MLZ])([^MLZ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const v = m[2].trim().split(/[ ,]+/).filter(Boolean).map(Number);
    if (m[1] === "M") {
      atual = new THREE.Shape();
      out.push(atual);
      const p = para3d(v[0], v[1]);
      atual.moveTo(p.x, -p.z);
    } else if (m[1] === "L" && atual) {
      for (let i = 0; i < v.length; i += 2) {
        const p = para3d(v[i], v[i + 1]);
        atual.lineTo(p.x, -p.z);
      }
    }
  }
  return out;
}

export function Mapa3d({
  estrada,
  girando,
  aoFalhar,
}: {
  estrada: MapaNaEstrada;
  girando: boolean;
  /** chamado uma vez quando o aparelho não desenha 3D (a TV mostra o aviso) */
  aoFalhar: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotulosRef = useRef<HTMLDivElement>(null);
  const girandoRef = useRef(girando);
  girandoRef.current = girando;
  // o que muda a cada minuto fica numa ref: o laço de desenho lê sem
  // recriar a cena inteira a cada quadro
  const estradaRef = useRef(estrada);
  // o número da "foto" dos dados: o laço de desenho compara e remonta as
  // colunas/arcos quando ele muda — sem redesenhar o React
  const versaoRef = useRef(0);
  const impressaoRef = useRef("");
  useEffect(() => {
    estradaRef.current = estrada;
    // só remonta a cena quando os DADOS mudaram — a batida de 1 min quase
    // sempre devolve a mesma foto
    const impressao = impressaoDaEstrada(estrada);
    if (impressao === impressaoRef.current) return;
    impressaoRef.current = impressao;
    versaoRef.current += 1;
  }, [estrada]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const rotulosEl = rotulosRef.current;
    if (!canvas || !rotulosEl) return;
    const rotulos: HTMLDivElement = rotulosEl;
    let vivo = true;
    let limpar: (() => void) | null = null;

    (async () => {
      let THREE: Three;
      try {
        THREE = await import("three");
      } catch {
        aoFalhar();
        return;
      }
      if (!vivo) return;
      let renderer: InstanceType<Three["WebGLRenderer"]>;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      } catch {
        aoFalhar();
        return;
      }
      const reduzir = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const COBRE = new THREE.Color(CORES_TV.noPrazo);
      const CLARO = new THREE.Color("#ffc58f");
      const cena = new THREE.Scene();
      cena.fog = new THREE.Fog(0x120d09, 650, 1500);
      const camera = new THREE.PerspectiveCamera(36, 1, 1, 5000);
      const fixo = new THREE.Group(); // estados, chão, estrelas
      const vivoGrupo = new THREE.Group(); // colunas e arcos (refeitos a cada dado)
      cena.add(fixo, vivoGrupo);
      cena.add(new THREE.HemisphereLight(0xffd9b8, 0x0b0805, 0.55));
      const sol = new THREE.DirectionalLight(0xffe4c8, 0.5);
      sol.position.set(-300, 600, 250);
      cena.add(sol);

      // textura de brilho feita no próprio navegador (sem arquivo de fora)
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      r.addColorStop(0, "rgba(255,255,255,1)");
      r.addColorStop(0.18, "rgba(255,220,180,.85)");
      r.addColorStop(0.45, "rgba(255,150,80,.25)");
      r.addColorStop(1, "rgba(255,120,50,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 128, 128);
      const BRILHO = new THREE.CanvasTexture(c);
      const brilho = (cor: string | InstanceType<Three["Color"]>, tamanho: number, opacidade: number) => {
        const s = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: BRILHO, color: cor as never, transparent: true, opacity: opacidade, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        s.scale.set(tamanho, tamanho, 1);
        return s;
      };

      // estrelas ao fundo e o chão de pontinhos (a mesa de radar)
      {
        const n = 700;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const raio = 900 + Math.random() * 900;
          const a = Math.random() * Math.PI * 2;
          pos[i * 3] = Math.cos(a) * raio;
          pos[i * 3 + 1] = -200 + Math.random() * 900;
          pos[i * 3 + 2] = Math.sin(a) * raio;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        cena.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd7b0, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.5, fog: false })));
        const pts: number[] = [];
        for (let x = -420; x <= 420; x += 14)
          for (let z = -420; z <= 420; z += 14) if (x * x + z * z < 420 * 420) pts.push(x, -2, z);
        const chao = new THREE.BufferGeometry();
        chao.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        fixo.add(new THREE.Points(chao, new THREE.PointsMaterial({ color: 0x6b4a32, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.45 })));
      }

      // os estados: placas escuras com a borda acesa (mais acesa onde há pacote)
      const placas: Record<string, { material: InstanceType<Three["MeshStandardMaterial"]>; borda: InstanceType<Three["LineBasicMaterial"]> }> = {};
      for (const uf in UFS) {
        const geo = new THREE.ExtrudeGeometry(formasDoEstado(THREE, UFS[uf].d), { depth: PLACA, bevelEnabled: false });
        const material = new THREE.MeshStandardMaterial({ color: 0x231810, roughness: 0.45, metalness: 0.35, emissive: COBRE, emissiveIntensity: 0.04 });
        const placa = new THREE.Mesh(geo, material);
        placa.rotation.x = -Math.PI / 2;
        const borda = new THREE.LineBasicMaterial({ color: COBRE, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
        placa.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), borda));
        fixo.add(placa);
        placas[uf] = { material, borda };
      }

      // ---- o que muda com os dados: colunas, arcos, loja e rótulos --------
      const colGeo = new THREE.CylinderGeometry(1.4, 1.4, 1, 10, 1, true);
      colGeo.translate(0, 0.5, 0);
      const halGeo = new THREE.CylinderGeometry(4.2, 4.2, 1, 16, 1, true);
      halGeo.translate(0, 0.5, 0);
      type Coluna = { ponto: PontoNaEstrada; x: number; z: number; alvo: number; h: number; nucleo: InstanceType<Three["Mesh"]>; halo: InstanceType<Three["Mesh"]>; topo: InstanceType<Three["Sprite"]>; el: HTMLDivElement | null };
      type Arco = { curva: InstanceType<Three["QuadraticBezierCurve3"]>; cabeca: InstanceType<Three["Sprite"]>; fase: number; periodo: number };
      let colunas: Coluna[] = [];
      let arcos: Arco[] = [];
      let sede: { x: number; z: number; brilho: InstanceType<Three["Sprite"]>; anel: InstanceType<Three["Mesh"]>; el: HTMLDivElement } | null = null;
      let versaoDesenhada = -1;

      // as geometrias das colunas são UMA para todas as cidades: descartar
      // a cena não as apaga (viveriam só até a primeira remontagem); elas
      // saem no `limpar`
      const compartilhadas = new Set<object>([colGeo, halGeo]);
      const descartar = (obj: InstanceType<Three["Object3D"]>) => {
        obj.traverse((o) => {
          const m = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
          if (m.geometry && !compartilhadas.has(m.geometry)) m.geometry.dispose();
          if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
          else m.material?.dispose?.();
        });
      };

      function montarDados() {
        const dados = estradaRef.current;
        descartar(vivoGrupo);
        vivoGrupo.clear();
        rotulos.innerHTML = "";
        colunas = [];
        arcos = [];
        sede = null;

        // as placas acendem onde há pacote; vermelho onde há atraso
        const porUf = new Map(dados.porUf.map((e) => [e.uf, e]));
        const maior = Math.max(1, ...dados.porUf.map((e) => e.quantidade));
        for (const uf in placas) {
          const e = porUf.get(uf);
          const t = e ? Math.sqrt(e.quantidade / maior) : 0;
          const cor = e && e.atrasados > 0 ? new THREE.Color(CORES_TV.atrasado) : e && e.parados > 0 ? new THREE.Color(CORES_TV.parado) : COBRE;
          placas[uf].material.emissive = cor;
          placas[uf].material.emissiveIntensity = 0.04 + t * 0.22;
          placas[uf].borda.color = cor.clone().lerp(CLARO, e ? t * 0.5 : 0);
          placas[uf].borda.opacity = 0.22 + t * 0.6;
        }

        const comRotulo = new Set(rotulosDaTv(dados.pontos, matchMedia("(max-width: 700px)").matches ? 3 : 6));
        for (const p of dados.pontos) {
          const { x, z } = para3d(p.x, p.y);
          const cor = new THREE.Color(corDaCidade(p));
          const nucleo = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ color: cor.clone().lerp(new THREE.Color("#ffffff"), 0.45), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
          const halo = new THREE.Mesh(halGeo, new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
          const topo = brilho(cor, 22, 0.9);
          const base = brilho(cor, 30, 0.5);
          nucleo.position.set(x, PLACA, z);
          halo.position.set(x, PLACA, z);
          base.position.set(x, PLACA + 1, z);
          vivoGrupo.add(nucleo, halo, topo, base);
          let el: HTMLDivElement | null = null;
          if (comRotulo.has(p)) {
            el = document.createElement("div");
            el.className = "tv-rotulo";
            el.dataset.situacao = p.atrasados > 0 ? "atrasado" : p.parados > 0 ? "parado" : "ok";
            el.textContent = textoDoRotulo(p);
            rotulos.appendChild(el);
          }
          colunas.push({ ponto: p, x, z, alvo: alturaDaColuna(totalDoPonto(p)), h: reduzir ? alturaDaColuna(totalDoPonto(p)) : 0.01, nucleo, halo, topo, el });
        }

        if (dados.origem) {
          const { x, z } = para3d(dados.origem.x, dados.origem.y);
          const sb = brilho("#ffffff", 46, 0.95);
          sb.position.set(x, PLACA + 3, z);
          const anel = new THREE.Mesh(new THREE.RingGeometry(6, 7.2, 48), new THREE.MeshBasicMaterial({ color: CLARO, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
          anel.rotation.x = -Math.PI / 2;
          anel.position.set(x, PLACA + 0.4, z);
          vivoGrupo.add(sb, anel);
          const el = document.createElement("div");
          el.className = "tv-rotulo tv-rotulo-sede";
          el.textContent = `◆ ${dados.origem.cidade ?? dados.origem.uf} · sua loja`;
          rotulos.appendChild(el);
          sede = { x, z, brilho: sb, anel, el };

          // um arco por cidade, com uma luz que viaja da loja até ela
          for (const col of colunas) {
            const ini = new THREE.Vector3(x, PLACA + 2, z);
            const fim = new THREE.Vector3(col.x, PLACA + 2, col.z);
            const dist = ini.distanceTo(fim);
            const meio = ini.clone().lerp(fim, 0.5);
            meio.y += 30 + dist * 0.45;
            const curva = new THREE.QuadraticBezierCurve3(ini, meio, fim);
            const cor = new THREE.Color(corDaCidade(col.ponto));
            const problema = col.ponto.atrasados + col.ponto.parados > 0;
            const tubo = new THREE.Mesh(new THREE.TubeGeometry(curva, 64, problema ? 1.1 : 0.7, 6, false), new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: problema ? 0.55 : 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
            const cabeca = brilho(cor.clone().lerp(new THREE.Color("#ffffff"), 0.5), 18, 1);
            vivoGrupo.add(tubo, cabeca);
            arcos.push({ curva, cabeca, fase: Math.random(), periodo: 2600 + Math.random() * 1800 });
          }
        }
      }

      // câmera, tamanho e giro
      let largura = 1;
      let alturaTela = 1;
      const ajustar = () => {
        const rect = canvas.getBoundingClientRect();
        largura = Math.max(1, rect.width);
        alturaTela = Math.max(1, rect.height);
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(largura, alturaTela, false);
        camera.aspect = largura / alturaTela;
        camera.updateProjectionMatrix();
      };
      const observador = new ResizeObserver(ajustar);
      observador.observe(canvas);
      ajustar();

      const tmp = new THREE.Vector3();
      const pos = new THREE.Vector3();
      const poe = (el: HTMLElement, x: number, y: number, z: number) => {
        tmp.set(x, y, z).applyMatrix4(vivoGrupo.matrixWorld).project(camera);
        el.style.left = `${(tmp.x * 0.5 + 0.5) * largura}px`;
        el.style.top = `${(-tmp.y * 0.5 + 0.5) * alturaTela}px`;
        el.style.opacity = tmp.z < 1 ? "1" : "0";
      };

      let angulo = 0.6;
      let ultimo = performance.now();
      let raf = 0;
      const comeco = performance.now();
      function quadro(t: number) {
        if (!vivo) return;
        if (versaoDesenhada !== versaoRef.current) {
          // os dados mudaram desde o último desenho (ou é o primeiro quadro)
          versaoDesenhada = versaoRef.current;
          montarDados();
        }
        const dt = Math.min(64, t - ultimo);
        ultimo = t;
        if (girandoRef.current && !reduzir) angulo += dt * 0.00009;
        // a câmera balança devagar em volta do mapa, sempre com o norte para cima
        const longe = largura / alturaTela < 1 ? 1.4 : largura < 700 ? 1.2 : 1.05;
        const giro = Math.sin(angulo) * 0.45;
        camera.position.set(Math.sin(giro) * 560 * longe, (520 + Math.sin(angulo * 1.7) * 25) * longe, Math.cos(giro) * 560 * longe);
        camera.lookAt(0, 0, 35);

        const entrada = reduzir ? 1 : Math.min(1, Math.max(0, (t - comeco - 200) / 1600));
        for (const col of colunas) {
          const meta = col.alvo * (1 - Math.pow(1 - entrada, 3));
          col.h += (meta - col.h) * Math.min(1, dt / 180);
          const h = Math.max(0.01, col.h);
          col.nucleo.scale.y = h;
          col.halo.scale.y = h;
          col.topo.position.set(col.x, PLACA + h, col.z);
        }
        vivoGrupo.updateMatrixWorld();
        if (sede) {
          const respira = 0.75 + Math.sin(t / 600) * 0.25;
          (sede.brilho.material as { opacity: number }).opacity = 0.65 + respira * 0.3;
          const sa = reduzir ? 1 : 1 + ((t / 1600) % 1) * 2.2;
          sede.anel.scale.set(sa, sa, sa);
          (sede.anel.material as { opacity: number }).opacity = reduzir ? 0.6 : 0.8 * (1 - ((t / 1600) % 1));
          poe(sede.el, sede.x, PLACA + 16, sede.z);
        }
        for (const a of arcos) {
          // a luz viaja da loja até a cidade, e recomeça — é o "está andando"
          const k = reduzir ? 1 : ((t / a.periodo + a.fase) % 1);
          a.curva.getPoint(k, pos);
          a.cabeca.position.copy(pos);
          (a.cabeca.material as { opacity: number }).opacity = reduzir ? 0.6 : Math.sin(k * Math.PI) * 0.9 + 0.1;
        }
        for (const col of colunas) if (col.el) poe(col.el, col.x, PLACA + col.h + 8, col.z);
        renderer.render(cena, camera);
        raf = requestAnimationFrame(quadro);
      }
      raf = requestAnimationFrame(quadro);

      limpar = () => {
        cancelAnimationFrame(raf);
        observador.disconnect();
        descartar(cena);
        colGeo.dispose();
        halGeo.dispose();
        BRILHO.dispose();
        renderer.dispose();
        rotulos.innerHTML = "";
      };
    })();

    return () => {
      vivo = false;
      limpar?.();
    };
    // a cena nasce uma vez; os dados entram pela ref + versão (o laço relê)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" aria-label="Mapa 3D dos pacotes a caminho" />
      <div ref={rotulosRef} className="pointer-events-none absolute inset-0" aria-hidden />
    </div>
  );
}
