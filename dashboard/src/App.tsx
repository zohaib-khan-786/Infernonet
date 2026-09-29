/**
 * The application root.
 *
 * Two things and nothing else: the shell, and the page inside it.
 *
 * The page used to be composed here directly, above a masthead. It now lives in
 * `src/app/dashboard/DashboardPage.tsx` and the frame lives in
 * `src/components/layout/AppShell.tsx`, which is the split guide 41 asks for
 * and guide 42's `src/app/` directory is for. The split is worth a sentence
 * because both halves are the same code as before, moved: the reading order of
 * the page is unchanged, the store is unchanged, and every panel below the frame
 * is the component it always was.
 *
 * The skip link and the SVG hatch pattern are the two things that used to be
 * here and are not any more, and both belong to the frame rather than the page:
 *
 *   - the skip link has to be the first focusable thing in the document, and
 *     that is a property of the document, not of whichever page is mounted
 * WHY THE PAGE IS A ROUTE TABLE NOW
 * -----------------------------------------------------------------------------
 * There is one page and a shell when this file was written. There are now eleven
 * destinations (guide §4's own list, minus Integrations), and the shell still
 * renders exactly one child — so the child is whatever `RouteOutlet` resolves
 * from the fragment. Nothing about the shell changes: the sidebar, the header,
 * the skip link and the content grid are untouched, and `RouteOutlet` returns a
 * page fragment rather than another shell.
 *
 * The pages are code-split behind `React.lazy` inside `routes.tsx`, and the
 * dashboard is the only one on a cold load, because it is the page a volunteer
 * opens in a basement on one bar of signal.
 *
 *   - `MarkDefs` publishes the one SVG pattern every `sensor_fault` mark
 *     references, so it is rendered once by the app and not once per page
 */
import { AppShell } from './components/layout/AppShell';
import { RouteOutlet } from './app/routes';

export function App() {
  return (
    <AppShell>
      <RouteOutlet />
    </AppShell>
  );
}
