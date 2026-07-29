# Class-relative metrics never cross classes

Comparing an Anchor Racer against Comparison Riders is allowed to cross class
boundaries on overall metrics — overall position and overall percentile rank a
rider against the whole field, so they mean the same thing for everyone — but
class-relative metrics are restricted to riders who share the Anchor Racer's
class, and riders from other classes are omitted from those views with a note
naming them. We rejected the obvious alternative of normalizing class position
into class percentile so that every rider could share one axis, even though the
codebase already computes exactly that for the History Dashboard and it would
have been nearly free: percentile normalizes the *size* of a class, not its
*strength*, so a rider winning a C class outranks a mid-pack AA rider on such a
chart while being minutes slower over the same course. That failure is worse
than the one it fixes, because a normalized axis looks rigorous and invites the
comparison rather than refusing it.
