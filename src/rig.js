import * as THREE from 'three';
import { SEGMENTS, SEGMENT_NAMES } from './skeleton.js';

// Works out, for whatever is currently planted on the floor, which points of
// the body can be grabbed and what each grab rotates.
//
// Segments form a tree joined at joints; a joint is named after the child
// segment it attaches (the joint 'shinL' is the left knee). The planted
// segments are the "anchors". Dragging a handle rotates one segment about the
// joint on its anchor side, and everything further from the floor follows
// rigidly, exactly as if the skeleton were rooted where it touches the ground.

const TIPS = SEGMENT_NAMES.filter((name) => SEGMENTS[name].tip).map((name) => ({
  id: SEGMENTS[name].tip.id,
  segment: name,
  p: SEGMENTS[name].tip.p,
}));

const JOINTS = SEGMENT_NAMES.filter((name) => SEGMENTS[name].parent);

const LINKS = {};
for (const name of SEGMENT_NAMES) LINKS[name] = [];
for (const joint of JOINTS) {
  LINKS[SEGMENTS[joint].parent].push({ to: joint, joint });
  LINKS[joint].push({ to: SEGMENTS[joint].parent, joint });
}

// Rest-pose joint positions, used only to rank competing handles.
const REST = {};
for (const name of SEGMENT_NAMES) {
  const seg = SEGMENTS[name];
  REST[name] = seg.parent ? seg.at.clone().add(REST[seg.parent]) : new THREE.Vector3();
}

export function mirrorName(name) {
  if (!SEGMENTS[name]?.side) return name;
  return name.slice(0, -1) + (name.endsWith('L') ? 'R' : 'L');
}

// Segments reachable from `start` without crossing any of the blocked joints.
function component(start, blocked) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const link of LINKS[queue.shift()]) {
      if (blocked.has(link.joint) || seen.has(link.to)) continue;
      seen.add(link.to);
      queue.push(link.to);
    }
  }
  return seen;
}

// Shortest route from `start` to an anchor without crossing `blockedJoint`.
// Returns the number of joints crossed and the first joint on the route.
function routeToAnchor(start, blockedJoint, anchors) {
  if (anchors.has(start)) return { dist: 0, joint: null };
  const seen = new Set([start]);
  let layer = [{ seg: start, first: null }];
  for (let dist = 1; layer.length; dist++) {
    const next = [];
    for (const { seg, first } of layer) {
      for (const link of LINKS[seg]) {
        if (link.joint === blockedJoint || seen.has(link.to)) continue;
        const step = { seg: link.to, first: first || link.joint };
        if (anchors.has(link.to)) return { dist, joint: step.first };
        seen.add(link.to);
        next.push(step);
      }
    }
    layer = next;
  }
  return { dist: Infinity, joint: null };
}

// The segments that turn when `segment` is rotated about `pivot`: everything
// on the segment's side of the pivot. If the pivot is on a limb and the
// matching limb on the other side is planted too (standing on both feet,
// say), that limb's planted part also stays put.
export function movingSet(segment, pivot, anchors) {
  const moving = component(segment, new Set([pivot]));
  if (SEGMENTS[pivot].side) {
    const twin = mirrorName(pivot);
    const beyondTwin = component(segment, new Set([twin]));
    const planted = SEGMENT_NAMES.some((n) => !beyondTwin.has(n) && anchors.has(n));
    if (planted) for (const n of [...moving]) if (!beyondTwin.has(n)) moving.delete(n);
  }
  return moving;
}

// Handles available for a set of anchored segment names. Each handle is
//   { id, segment, pivot, rock, points: [{ segment, local }] }
// `segment` rotates about the joint `pivot`. `rock` handles have no pivot
// joint: they tip the whole body about its contact with the floor. A handle
// sits at the average of its `points`.
export function buildHandles(anchors) {
  const candidates = [];
  const consider = (id, point, restPoint, segment, route) => {
    if (route.dist === Infinity) return;
    const rock = route.dist === 0;
    if (rock && (anchors.size !== 1 || SEGMENTS[segment].side)) return;
    const from = rock ? REST[segment] : REST[route.joint];
    candidates.push({
      id,
      segment,
      pivot: route.joint,
      rock,
      side: SEGMENTS[point.segment].side,
      reach: restPoint.distanceTo(from),
      points: [point],
    });
  };

  for (const joint of JOINTS) {
    const parent = SEGMENTS[joint].parent;
    const viaParent = routeToAnchor(parent, joint, anchors);
    const viaChild = routeToAnchor(joint, joint, anchors);
    const useChild = viaChild.dist < viaParent.dist;
    const point = { segment: joint, local: new THREE.Vector3() };
    consider(joint, point, REST[joint], useChild ? joint : parent, useChild ? viaChild : viaParent);
  }
  for (const tip of TIPS) {
    const local = tip.p;
    const point = { segment: tip.segment, local };
    consider(tip.id, point, local.clone().add(REST[tip.segment]), tip.segment, routeToAnchor(tip.segment, null, anchors));
  }

  // Several grab points can end up turning the same segment; keep one each.
  const bySegment = new Map();
  for (const c of candidates) {
    if (!bySegment.has(c.segment)) bySegment.set(c.segment, []);
    bySegment.get(c.segment).push(c);
  }
  const handles = [];
  for (const group of bySegment.values()) {
    const longest = (list) => list.reduce((a, b) => (b.reach > a.reach + 1e-6 ? b : a));
    const central = group.filter((c) => !c.side);
    if (central.length || SEGMENTS[group[0].segment].side) {
      handles.push(longest(central.length ? central : group));
      continue;
    }
    // A central segment reachable only from left/right joints (the pelvis via
    // the hips): put one handle midway between the pair.
    const best = longest(group);
    const twin = group.find((c) => c.id === mirrorName(best.id));
    handles.push(twin ? { ...best, id: best.id + '+' + twin.id, points: [best.points[0], twin.points[0]] } : best);
  }
  return handles;
}
