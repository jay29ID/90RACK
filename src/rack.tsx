// The non-source components of the rack: power conditioner, A/V receiver
// and graphic equalizer.

import { Spectrum } from './components/Spectrum';
import { Btn, Knob, Led, Unit, Vfd } from './components/ui';
import { useClock } from './hooks';
import { DSP_MODES, EQ_BANDS, INPUTS, getState, selectInput, setState, transport, useStore, volumeDb } from './store';

export function powerToggle() {
  const { power } = getState();
  if (power) {
    INPUTS.forEach((i) => transport(i.id)?.pause());
    setState({ power: false, booting: false });
    return;
  }
  setState({ power: true, booting: true });
  setTimeout(() => setState({ booting: false }), 2200);
}

export function PowerConditioner() {
  const power = useStore((s) => s.power);
  const lamp = useStore((s) => s.lamp);
  const pairOpen = useStore((s) => s.pairOpen);
  const clock = useClock();
  return (
    <Unit model="PL-PLUS" name="Power Conditioner" u={1} brand="90RACK" className="unit-power">
      <div className="power-face">
        <Btn variant="power" title="Power" onClick={powerToggle} lit={power} label="POWER" />
        <Vfd color="amber" className="power-vfd">
          <span className="vfd-big">{power ? '120V' : ''}</span>
        </Vfd>
        <div className="power-meter">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} className={power && i < 7 ? 'on' : ''} />
          ))}
        </div>
        <Vfd color="cyan" className="clock-vfd">
          <span className="vfd-big">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </Vfd>
        <Btn label="REMOTE" variant="round" lit={pairOpen} onClick={() => setState({ pairOpen: !pairOpen })} title="Pair your phone as a remote (R)" />
        <Btn label="LIGHTS" variant="round" lit={lamp} onClick={() => setState({ lamp: !lamp })} title="Rack lights" />
      </div>
    </Unit>
  );
}

export function Receiver() {
  const power = useStore((s) => s.power);
  const booting = useStore((s) => s.booting);
  const input = useStore((s) => s.input);
  const volume = useStore((s) => s.volume);
  const muted = useStore((s) => s.muted);
  const dsp = useStore((s) => s.dsp);
  const theater = useStore((s) => s.theater);
  const crt = useStore((s) => s.crt);
  const np = useStore((s) => s.now[s.input]);
  const inputInfo = INPUTS.find((i) => i.id === input)!;

  return (
    <Unit model="STR-DA90ES" name="Audio / Video Control Center" u={4} className="unit-receiver" finish="black">
      <div className="rx-face">
        <div className="rx-left">
          <Btn variant="power" title="Power" onClick={powerToggle} lit={power} label="POWER" />
          <div className="phones">
            <i />
            <span className="btn-label">PHONES</span>
          </div>
        </div>

        <div className="rx-center">
          <Vfd className="rx-vfd" color="cyan">
            {booting ? (
              <span className="vfd-huge boot">HELLO</span>
            ) : power ? (
              <>
                <div className="rx-vfd-row">
                  <span className="vfd-huge">{inputInfo.label}</span>
                  <span className="rx-vol">
                    {muted ? <span className="vfd-huge blink">MUTING</span> : <span className="vfd-huge">{volumeDb(volume)}</span>}
                    {!muted && <span className="vfd-tag">dB</span>}
                  </span>
                </div>
                <div className="rx-vfd-row small">
                  <span className="vfd-tag">{dsp}</span>
                  <span className="vfd-tag">{np?.playing ? 'PCM' : '---'}</span>
                  <span className="vfd-tag hot">{inputInfo.source.toUpperCase()}</span>
                  <span className="vfd-scroll">{np ? `${np.title}${np.subtitle ? '  ·  ' + np.subtitle : ''}` : ''}</span>
                </div>
                <div className="rx-speakers">
                  {['L', 'C', 'R', 'SL', 'SR', 'SW'].map((c) => (
                    <span key={c} className={np?.playing ? 'on' : ''}>
                      {c}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </Vfd>
          <div className="rx-inputs">
            {INPUTS.map((i, n) => (
              <Btn key={i.id} label={i.label} title={`${i.label} — ${i.source} (${n + 1})`} lit={power && input === i.id} onClick={() => selectInput(i.id)} variant="pill" />
            ))}
          </div>
          <div className="rx-modes">
            <Btn
              label="DSP MODE"
              variant="wide"
              onClick={() => setState({ dsp: DSP_MODES[(DSP_MODES.indexOf(dsp) + 1) % DSP_MODES.length] })}
              title="Sound field (applies to DVD & CD)"
            />
            <Btn label="MUTING" variant="wide" lit={muted} onClick={() => setState({ muted: !muted })} />
            <Btn label="CRT" variant="wide" lit={crt} onClick={() => setState({ crt: !crt })} title="Scanline filter on the TV" />
            <Btn label="THEATER" variant="wide" lit={theater} onClick={() => setState({ theater: !theater })} title="Full screen TV (T)" />
          </div>
        </div>

        <div className="rx-right">
          <Knob value={volume} onChange={(v) => setState({ volume: Math.round(v), muted: false })} size={118} label="MASTER VOLUME" />
          <div className="rx-badges">
            <Led on={power} color="amber" label="DOLBY PRO LOGIC" />
            <Led on={power && Boolean(np?.playing)} color="blue" label="DIGITAL" />
          </div>
        </div>
      </div>
    </Unit>
  );
}

const fmtHz = (f: number) => (f >= 1000 ? f / 1000 + 'k' : String(f));

export function Equalizer() {
  const eq = useStore((s) => s.eq);
  const power = useStore((s) => s.power);
  const input = useStore((s) => s.input);
  const affects = input === 'dvd' || input === 'cd';

  return (
    <Unit model="SEQ-310" name="Graphic Equalizer / Spectrum Analyzer" u={3} className="unit-eq">
      <div className="eq-face">
        <div className="eq-display">
          <Spectrum bands={30} segments={14} className="eq-spectrum" />
          {power && !affects && <span className="eq-note">EQ BYPASS · {input.toUpperCase()}</span>}
        </div>
        <div className="eq-sliders">
          {EQ_BANDS.map((f, i) => (
            <label key={f} className="eq-band">
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={eq[i]}
                aria-label={`${fmtHz(f)}Hz`}
                onChange={(e) => {
                  const next = eq.slice();
                  next[i] = Number(e.target.value);
                  setState({ eq: next });
                }}
                onDoubleClick={() => {
                  const next = eq.slice();
                  next[i] = 0;
                  setState({ eq: next });
                }}
              />
              <span>{fmtHz(f)}</span>
            </label>
          ))}
          <Btn label="FLAT" variant="round" onClick={() => setState({ eq: Array(10).fill(0) })} />
        </div>
      </div>
    </Unit>
  );
}
