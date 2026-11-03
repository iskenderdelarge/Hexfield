import { Building2, Crown, Hammer, X } from 'lucide-react';
import { productionFor, type City } from '../sim/engine';
import { CITY_INHERENT_PRODUCTION, UNIT_PRODUCTION_COST } from '../sim/config';
import { PATTERNS, PATTERN_BY_ID, type PatternId } from '../sim/patterns';

export function CityPanel({ city, ownerName, owned, disabled, onChange, onClose }: {
  city: City; ownerName: string; owned: boolean; disabled: boolean;
  onChange: (type: PatternId) => void; onClose: () => void;
}) {
  const progress = productionFor(city), overflow = city.productionOverflow || 0;
  const saved = PATTERNS.filter((pattern) => pattern.id !== city.producing && productionFor(city, pattern.id) > 0);
  const turns = Math.max(1, Math.ceil((UNIT_PRODUCTION_COST - progress - overflow) / CITY_INHERENT_PRODUCTION));
  return <section className="play-box city-box" aria-label="City management">
    <div className="city-box-head"><span className="micro-label"><Building2 size={13} /> CITY MANAGEMENT</span>
      <button className="city-close-btn" onClick={onClose} aria-label="Close city menu"><X size={16} /></button></div>
    <div className="city-meta"><strong>{city.name} {city.isCapital && <Crown size={14} />}</strong>
      <small>{ownerName}{city.isCapital ? ' / original capital' : ''}</small></div>
    <div className="production-income"><Hammer size={14} /><strong>{CITY_INHERENT_PRODUCTION}</strong> production / turn</div>
    {owned ? <div className="city-prod-section">
      <div className="prod-progress-label"><span>{PATTERN_BY_ID[city.producing].name}</span><span data-production-progress>{progress} / {UNIT_PRODUCTION_COST}</span></div>
      <div className="prod-bar"><div className="prod-bar-fill" style={{ width: `${Math.min(100, progress / UNIT_PRODUCTION_COST * 100)}%` }} /></div>
      <div className="production-detail"><small>{progress >= UNIT_PRODUCTION_COST ? 'Ready; waiting for an open spawn tile' : `${turns} turn${turns === 1 ? '' : 's'} remaining`}</small>
        <small data-production-overflow>Overflow: <b>{overflow}</b></small></div>
      <label className="select-prod-label">PRODUCE / {UNIT_PRODUCTION_COST} PRODUCTION EACH
        <select aria-label="City production" className="city-prod-select" value={city.producing} disabled={disabled}
          onChange={(event) => onChange(event.target.value as PatternId)}>
          {PATTERNS.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.name}{productionFor(city, pattern.id) > 0 ? ` (${productionFor(city, pattern.id)} saved)` : ''}</option>)}
        </select>
      </label>
      {saved.length > 0 && <div className="saved-production"><span className="micro-label">PAUSED PROJECTS</span>{saved.map((pattern) =>
        <div key={pattern.id}><span>{pattern.name}</span><b>{productionFor(city, pattern.id)} / {UNIT_PRODUCTION_COST}</b></div>)}</div>}
      <p className="play-help production-note">Switching keeps progress with that unit. Overflow is applied once to the selected project next turn.</p>
    </div> : <p className="play-help">Enemy city. Encircle all six adjacent hexes, with at least one occupying unit, to capture it. The center cannot be entered.</p>}
  </section>;
}
