/**
 * Path operations on URIs.
 *
 * References:
 *
 * <ul>
 *
 * <li><cite><a href="http://tools.ietf.org/html/rfc3986"
 * >Uniform Resource Identifier (URI): Generic Syntax</a></cite></li>
 *
 * <li><cite><a href="http://www.w3.org/DesignIssues/Model.html"
 * >The Web Model: Information hiding and URI syntax (Jan 98)</a></cite></li>
 *
 * <li><a href="http://lists.w3.org/Archives/Public/uri/2001Aug/0021.html"
 * >URI API design [was: URI Test Suite] Dan Connolly (Sun, Aug 12 2001)</a>
 * </li>
 * </ul>
 *
 */
namespace Uris {
  /**
   * Appendix B. Parsing a URI Reference with a Regular Expression
   */
  const parts: RegExp = new RegExp(
    '(([^:/?#]+):)?(//([^/?#]*))?([^?#]*)(?([^#]*))?(#(.*))?'
  );

  /**
   * Combine URI reference with base URI
   * @param base an absolute URI
   * @param ref any URI
   *
   * @return per section 5. Reference Resolution of RFC3986
   *
   * @throws java.text.ParseException if base isn't an absoluteURI
   */
  export function combine(base: string, ref: string): string {
    var result = parts.exec(ref);
    if (result) {
      const [_1, _2, sr, _3, ar, pr, _4, qr, _5, fragment] = result;
      if (sr) {
        // ref is absolute; we're done.
        return ref;
      } else {
        result = parts.exec(base);
        if (result) {
          const [_1, _2, scheme, _3, ab, pb, _4, qb, _5, _6] = result;
          if (!scheme) {
            throw new Error('missing scheme in base URI' + base);
          }
          const authority = !ar ? ab : ar;
          var path;
          if (!pr) {
            path = pb;
          } else {
            if (pr.startsWith('/')) {
              path = pr;
            } else {
              path = merge(ab, pb, pr);
            }
          }

          const query = ar || pr || qr ? qr : qb;

          // 5.3. Component Recomposition
          return (
            scheme +
            ':' +
            (authority ? '//' + authority : '') +
            path +
            (query ? '?' + query : '') +
            (fragment ? '#' + fragment : '')
          );
        }
      }
    }
    throw new Error('invalid arguments');
  }

  /**
   * 5.2.3. Merge Paths
   */
  function merge(auth: string, pbase: string, pref: string): string {
    if (!pbase) {
      return auth ? '/' + pref : pref;
    } else {
      return merge2(dirname(pbase), pref);
    }
  }

  function merge2(base: string, ref: string): string {
    if (ref.startsWith('./')) {
      return merge2(base, ref.substring(2));
    } else {
      if (ref.startsWith('../')) {
        const refup = ref.substring(3);
        if (base == '/') {
          return merge2(base, refup);
        } else {
          return merge2(dirname(base.substring(0, base.length - 1)), refup);
        }
      } else {
        return base + ref;
      }
    }
  }

  function dirname(path: string): string {
    return path.substring(0, path.lastIndexOf('/') + 1);
  }
}
