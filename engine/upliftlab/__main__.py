import argparse
import json
import sys
from pathlib import Path

parser = argparse.ArgumentParser(prog='upliftlab', description='upliftlab local edition: the same UI and engine as uplift-lab.vercel.app, on your own Python. Run it with no command to open the UI.')
sub = parser.add_subparsers(dest='command', metavar='{serve,run,check}')
web = sub.add_parser('serve', help='open the web UI on localhost and run the engine natively (the default)')
web.add_argument('--host', default='127.0.0.1')
web.add_argument('--port', type=int, default=4180)
web.add_argument('--web', help='folder with the UI (defaults to web/ in a source checkout, else the UI inside the package)')
web.add_argument('--no-browser', action='store_true', help='do not open the browser')
check = sub.add_parser('check', help='list the libraries an algorithm file uses, then fit it once on synthetic data')
check.add_argument('file', metavar='FILE.py')
run = sub.add_parser('run', help='run a head-to-head comparison without the UI and write the result as JSON')
run.add_argument('--data', default='public/criteo', help='public/criteo (the bundled 200k-row sample) | synthetic/base | path to a CSV')
run.add_argument('--algorithms', default='all', help='comma-separated built-in ids, or "all"')
run.add_argument('--algorithm', action='append', default=[], metavar='FILE.py', help='add your own algorithm file (repeatable)')
run.add_argument('--cycles', type=int, default=8)
run.add_argument('--explore', type=float, default=.2)
run.add_argument('--target', type=float, default=.4)
run.add_argument('--seed', type=int, default=42)
run.add_argument('--mode', choices=['quantile', 'budget', 'knapsack', 'roi', 'validation'], default='budget', help='budget (default): by score until the budget runs out. quantile: the top q%%. knapsack: value - price * cost > 0, priced to the budget. roi: by value / cost while the expected efficiency meets --efficiency. validation: up to the share where uplift peaked on validation rows')
run.add_argument('--budget', type=float, default=.4, help='budget as a share of the expected cost of treating every candidate')
run.add_argument('--efficiency', type=float, default=.2, help='with --mode roi: required efficiency gain over random selection')
run.add_argument('--base-learner', choices=['ridge', 'tree'], default='ridge', help='base model of the built-in algorithms')
run.add_argument('--out', help='write the result JSON here (open it in the web UI under 실행 기록 → 결과 JSON 열기)')


def main(argv=None):
    args = parser.parse_args(argv)
    if args.command is None:  # plain `upliftlab` opens the UI
        args = parser.parse_args(['serve'])
    if args.command == 'serve':
        from .server import serve
        serve(args.host, args.port, args.web, open_browser=not args.no_browser)
    elif args.command == 'check':
        from . import bridge
        from .server import detect_devices
        devices = detect_devices()
        bridge.state.update(runtime='local', device=devices[0], devices=devices)
        path = Path(args.file)
        code = path.read_text(encoding='utf-8')
        out = bridge.check(code, path.stem)
        print(f"{path.name} · {out.get('name') or path.stem}")
        shown = {'ok': lambda l: f"{l['package']} {l['version'] or ''}".strip(), 'missing': lambda l: f"{l['package']} (missing · pip install {l['package']})"}
        print('libraries: ' + (' · '.join(shown.get(l['status'], shown['missing'])(l) for l in out['libraries']) or 'standard library only'))
        if out['ok']:
            out = bridge.try_algorithm(code, path.stem, out.get('name'))
        if not out['ok']:
            sys.exit(f"{path}:{out.get('line') or '?'}: {out['error']}")
        print(f"quick check: ok · test AUCC truth {out['auccTruth']:.3f} · observed {out['aucc']:.3f} · fit {out['ms']:.0f} ms on {out['split']['train']:,} rows · device {devices[0]}")
    else:
        from . import bridge, datasets
        from .server import detect_devices
        devices = detect_devices()
        bridge.state.update(runtime='local', device=devices[0], devices=devices)
        builtins = {a['id']: a for a in bridge.builtins()}
        ids = list(builtins) if args.algorithms == 'all' else [a for a in args.algorithms.split(',') if a]
        unknown = [a for a in ids if a not in builtins]
        if unknown:
            sys.exit(f'unknown algorithm: {", ".join(unknown)} (choose from {", ".join(builtins)})')
        algorithms = [{'id': a, 'name': builtins[a]['name'], 'code': builtins[a]['code']} for a in ids]
        for file in args.algorithm:
            code = Path(file).read_text(encoding='utf-8')
            check = bridge.check(code, Path(file).stem)
            if not check['ok']:
                sys.exit(f'{file}:{check.get("line") or "?"}: {check["error"]}')
            algorithms.append({'id': 'file-' + Path(file).stem, 'name': check.get('name') or Path(file).stem, 'code': code})
        dataset = args.data
        if dataset.startswith('public/'):
            bridge.fetch_dataset(dataset)
        elif not dataset.startswith('synthetic/'):
            path = Path(dataset)
            dataset = 'upload/' + path.name
            bridge.add_dataset(dataset, path.read_text(encoding='utf-8'), path.name)
        print(f'{dataset} · {len(algorithms)} algorithms · {args.cycles} cycles · device {devices[0]}', file=sys.stderr)
        bridge.set_reporter(lambda m: (lambda d: d.get('phase') == 'done' and print(f"  c{d['cycle']} {d['arm']} done", file=sys.stderr))(json.loads(m)))
        result = bridge.run_all(dataset, algorithms, args.cycles, args.explore, args.target, args.seed, args.mode, args.budget, args.base_learner, args.efficiency)
        by = result['summary']['by']
        measure = ('incremental' if by.lower().endswith('incr') else 'gain') + (' (truth)' if by.startswith('truth') else ' (observed)')
        volume = by.lower().endswith('incr')  # ranked by incremental outcome: the band is the gap to first place, as on the screen
        print(f"\n{'rank':<5}{'algorithm':<26}{measure:>22}{'vs 1st, 95% CI' if volume else 'observed 95% CI':>30}{'AUCC':>8}{'Qini':>8}{'fit ms':>9}")
        for s in sorted(result['summary']['arms'], key=lambda s: s['rank']):
            g, ci, auc, ms = s[by], s['ci'], s['aucc'], s['trainMs']
            gain = '—' if g is None else f'{g:,.0f}' if volume else f'{g:+.1%}'
            q = '—' if s['qini'] is None else f"{s['qini']:.3f}"
            gap = s.get('vsLeader') or {}
            if volume:
                band = '1st' if s['rank'] == 1 else '—' if gap.get('diff') is None or gap.get('ci', [None])[0] is None else f"{gap['diff']:+,.0f} [{gap['ci'][0]:+,.0f}, {gap['ci'][1]:+,.0f}]"
            else:
                band = '—' if ci[0] is None else f'[{ci[0]:+.1%}, {ci[1]:+.1%}]'
            auc = '—' if auc is None else f'{auc:.3f}'
            ms = '—' if ms is None else f'{ms:.0f}'
            print(f"{s['rank']:<5}{s['name'][:25]:<26}{gain:>22}{band:>30}{auc:>8}{q:>8}{ms:>9}")
        print('\n' + conclusion(result, args.mode))
        if args.out:
            Path(args.out).write_text(json.dumps({'format': 'upliftlab.run/1', **result}, ensure_ascii=False))
            print(f'\nwrote {args.out}', file=sys.stderr)


def conclusion(result, mode):
    """One line under the table: who won, by how much over Random, on which basis."""
    arms, by = result['summary']['arms'], result['summary']['by']
    lead = min(arms, key=lambda s: s['rank'])
    random = next((s for s in arms if s['arm'] == 'random_baseline' and s is not lead), None)
    basis = 'true effect, known for synthetic data' if by.startswith('truth') else 'observed: treated minus control'
    if lead.get(by) is None:
        return f"{lead['name']} ranks first ({basis})."
    if by.lower().endswith('incr'):
        line = f"{lead['name']} ranks first with {lead[by]:,.0f} incremental outcome"
        if random and random.get(by):
            line += f", {lead[by] - random[by]:+,.0f} ({lead[by] / random[by] - 1:+.0%}) over Random"
        return line + (' for the same budget' if mode in ('budget', 'knapsack') else '') + f' ({basis}).'
    return f"{lead['name']} ranks first with {lead[by]:+.1%} cost efficiency over random selection ({basis})."


if __name__ == '__main__':
    main()
