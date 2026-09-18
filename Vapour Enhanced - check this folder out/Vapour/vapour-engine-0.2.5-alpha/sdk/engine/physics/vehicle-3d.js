import { copyPosition, finite, positive, nonnegative, collisionBits, locomotionSteps, findSafeCharacterPosition3d } from './locomotion-3d.js';
/** Experimental kinematic bicycle controller. Translation uses native Rapier
 * sweeps, rotation is clearance tested, and integration uses bounded fixed
 * substeps. It intentionally does not claim tire/rigid-body suspension physics. */
export class ArcadeVehicleController3d {
    #world;
    #half;
    #query;
    #wheelbase;
    #wheelRadius;
    #max;
    #reverse;
    #acceleration;
    #braking;
    #drag;
    #steeringLimit;
    #position;
    #yaw;
    #speed = 0;
    #steering = 0;
    #wheelRotation = 0;
    #vertical = 0;
    #roll = 0;
    #pitch = 0;
    #grounded = false;
    #collisions = [];
    constructor(world, options) {
        this.#world = world;
        this.#position = copyPosition(options.position);
        this.#yaw = finite(options.yaw ?? 0, 'Vehicle yaw');
        this.#half = copyPosition(options.halfExtents ?? [.94, .73, 2.28]);
        this.#half.forEach(x => positive(x, 'Vehicle half extent'));
        this.#wheelbase = positive(options.wheelbase ?? 2.78, 'Vehicle wheelbase');
        this.#wheelRadius = positive(options.wheelRadius ?? .34, 'Vehicle wheel radius');
        this.#max = positive(options.maxSpeed ?? 30, 'Vehicle maximum speed');
        this.#reverse = positive(options.reverseSpeed ?? 8, 'Vehicle reverse speed');
        this.#acceleration = positive(options.acceleration ?? 7, 'Vehicle acceleration');
        this.#braking = positive(options.braking ?? 16, 'Vehicle braking');
        this.#drag = nonnegative(options.drag ?? .35, 'Vehicle rolling drag');
        this.#steeringLimit = positive(options.steeringLimit ?? .56, 'Vehicle steering limit');
        if (this.#steeringLimit >= Math.PI / 2)
            throw new Error('Vehicle steering limit must be below pi/2.');
        this.#query = { shape: { type: 'box', halfExtents: this.#half }, offset: .025, slide: true, autostepMaxHeight: null, snapToGround: .2, maxSlopeClimbDegrees: 35, minSlopeSlideDegrees: 40, layer: collisionBits(options.layer ?? 1), mask: collisionBits(options.mask ?? 0xffff_ffff), includeSensors: false };
    }
    get state() { return { position: [...this.#position], yaw: this.#yaw, speed: this.#speed, steeringAngle: this.#steering, wheelRotation: this.#wheelRotation, bodyRoll: this.#roll, bodyPitch: this.#pitch, grounded: this.#grounded, collisions: this.#collisions }; }
    teleport(position, yaw = this.#yaw) { this.#position = copyPosition(position); this.#yaw = finite(yaw, 'Vehicle yaw'); this.#speed = 0; this.#vertical = 0; this.#steering = 0; this.#roll = 0; this.#pitch = 0; this.#grounded = false; }
    update(dt, input) {
        const steps = locomotionSteps(dt), step = dt / steps;
        const throttle = clamp(finite(input.throttle, 'Vehicle throttle'), -1, 1), steer = clamp(finite(input.steer, 'Vehicle steer'), -1, 1), brake = clamp(finite(input.brake ?? 0, 'Vehicle brake'), 0, 1);
        for (let i = 0; i < steps; i++)
            this.#step(step, throttle, steer, brake, input.handbrake ?? false);
        return this.state;
    }
    findExitPosition(options = {}) {
        // Check driver, passenger, then rear. Never teleport through a wall.
        for (const [x, z] of [[this.#half[0] + .8, 0], [-this.#half[0] - .8, 0], [0, this.#half[2] + .8]]) {
            const c = Math.cos(this.#yaw), s = Math.sin(this.#yaw);
            const result = findSafeCharacterPosition3d(this.#world, [this.#position[0] + x * c + z * s, this.#position[1] - this.#half[1], this.#position[2] - x * s + z * c], { ...options, layer: this.#query.layer, mask: this.#query.mask });
            if (result)
                return result;
        }
        return undefined;
    }
    #step(dt, throttle, steer, brake, handbrake) {
        const before = this.#speed;
        const opposite = throttle * this.#speed < 0;
        if (brake > 0 || handbrake || opposite)
            this.#speed = approachZero(this.#speed, this.#braking * (handbrake ? 1.5 : Math.max(brake, opposite ? Math.abs(throttle) : 0)) * dt);
        else
            this.#speed += throttle * this.#acceleration * dt;
        this.#speed = approachZero(this.#speed, (this.#drag + .0015 * this.#speed * this.#speed) * dt);
        this.#speed = clamp(this.#speed, -this.#reverse, this.#max);
        const steerTarget = steer * this.#steeringLimit / (1 + Math.abs(this.#speed) * .055);
        this.#steering += clamp(steerTarget - this.#steering, -2.2 * dt, 2.2 * dt);
        const travel = (before + this.#speed) * .5 * dt;
        const yawDelta = travel / this.#wheelbase * Math.tan(this.#steering);
        const newYaw = this.#yaw + yawDelta;
        const rotation = [0, Math.sin(newYaw / 2), 0, Math.cos(newYaw / 2)];
        // Translational CCD alone cannot prevent a rotating corner entering a wall.
        const overlaps = Math.abs(yawDelta) > 1e-6 ? this.#world.overlapShape(this.#position, rotation, this.#query.shape, { layer: this.#query.layer, mask: this.#query.mask, includeSensors: false }) : [];
        const usedYaw = overlaps.length ? this.#yaw : newYaw;
        const midYaw = (usedYaw + this.#yaw) / 2;
        this.#vertical = this.#grounded ? -1 : Math.max(-45, this.#vertical - 20 * dt);
        const desired = [-Math.sin(midYaw) * travel, this.#vertical * dt, -Math.cos(midYaw) * travel];
        const result = this.#world.moveCharacter(dt, this.#position, [0, Math.sin(usedYaw / 2), 0, Math.cos(usedYaw / 2)], desired, this.#query);
        this.#position[0] += result.translation[0];
        this.#position[1] += result.translation[1];
        this.#position[2] += result.translation[2];
        this.#yaw = usedYaw;
        this.#grounded = result.grounded;
        this.#collisions = result.collisions;
        const progress = -Math.sin(midYaw) * result.translation[0] - Math.cos(midYaw) * result.translation[2];
        if (Math.abs(progress) + .001 < Math.abs(travel))
            this.#speed = progress / dt;
        this.#wheelRotation += progress / this.#wheelRadius;
        const smooth = 1 - Math.exp(-8 * dt);
        this.#pitch += (clamp((this.#speed - before) / dt * .004, -.045, .045) - this.#pitch) * smooth;
        this.#roll += (clamp(this.#speed * yawDelta / dt * .003, -.07, .07) - this.#roll) * smooth;
    }
}
function clamp(x, min, max) { return Math.max(min, Math.min(max, x)); }
function approachZero(x, amount) { return Math.sign(x) * Math.max(0, Math.abs(x) - amount); }
/**
 * A raycast vehicle: one ray per wheel, a spring-damper on each ray, and a
 * slip-based tyre at each contact, all as forces on a dynamic chassis.
 *
 * It owns no body. The caller inserts the chassis, then each fixed step
 * passes that body's snapshot in and lets the vehicle queue forces. That is
 * what keeps it a controller rather than a second physics engine: the solver
 * still decides what happens when the car meets a wall or another car.
 *
 * The tyre model is deliberately a friction circle with linear stiffness in
 * slip ratio and slip angle. It saturates, so a wheel can spin and a car can
 * drift, and it is simple enough to tune by feel.
 */
export class RaycastVehicle3d {
    #world;
    #chassis;
    #wheels;
    #engine;
    #brake;
    #lock;
    #ackermann;
    #inertia;
    #longitudinal;
    #lateral;
    #forward;
    #up;
    #filter;
    #wheelbase;
    #track;
    #speed = 0;
    constructor(world, options) {
        this.#world = world;
        if (!Number.isSafeInteger(options.chassis) || options.chassis <= 0)
            throw new Error('Vehicle chassis must be a positive body id.');
        this.#chassis = options.chassis;
        if (options.wheels.length === 0)
            throw new Error('A raycast vehicle needs at least one wheel.');
        this.#engine = nonnegative(options.maxEngineTorque ?? 600, 'Vehicle engine torque');
        this.#brake = nonnegative(options.maxBrakeTorque ?? 1500, 'Vehicle brake torque');
        this.#lock = positive(options.maxSteeringAngle ?? 0.6, 'Vehicle steering angle');
        if (this.#lock >= Math.PI / 2)
            throw new Error('Vehicle steering angle must be below pi/2.');
        this.#ackermann = options.ackermann ?? true;
        // This includes the engine and driveline reflected at the wheel. A bare
        // wheel is commonly near 1 kg.m2, but using that value here lets a 600 Nm
        // engine change surface speed by several metres per second in one 60 Hz
        // step. The reflected inertia keeps the explicit tyre integration stable.
        this.#inertia = positive(options.wheelInertia ?? 12, 'Vehicle wheel inertia');
        this.#longitudinal = positive(options.longitudinalStiffness ?? 10, 'Vehicle longitudinal stiffness');
        this.#lateral = positive(options.lateralStiffness ?? 8, 'Vehicle lateral stiffness');
        this.#forward = unit(options.forward ?? [0, 0, -1], 'Vehicle forward');
        this.#up = unit(options.up ?? [0, 1, 0], 'Vehicle up');
        this.#filter = { layer: collisionBits(options.layer ?? 1), mask: collisionBits(options.mask ?? 0xffff_ffff), includeSensors: false, excludeBody: this.#chassis };
        this.#wheels = options.wheels.map((wheel) => {
            const suspension = {
                restLength: positive(wheel.suspension?.restLength ?? 0.3, 'Wheel suspension rest length'),
                stiffness: positive(wheel.suspension?.stiffness ?? 30_000, 'Wheel suspension stiffness'),
                damping: nonnegative(wheel.suspension?.damping ?? 3_000, 'Wheel suspension damping'),
                maxTravel: positive(wheel.suspension?.maxTravel ?? 0.25, 'Wheel suspension travel'),
            };
            return {
                attach: copyPosition(wheel.position), radius: positive(wheel.radius, 'Wheel radius'), suspension,
                steering: wheel.steering ?? false, driven: wheel.driven ?? false, friction: nonnegative(wheel.friction ?? 1, 'Wheel friction'),
                spin: 0, omega: 0, steeringAngle: 0, compression: 0, grounded: false,
                position: [...wheel.position], contactPoint: [0, 0, 0], contactNormal: [0, 1, 0],
                suspensionForce: 0, slipRatio: 0, slipAngle: 0,
            };
        });
        // Ackermann geometry from where the wheels actually are.
        const along = this.#wheels.map((wheel) => dot(wheel.attach, this.#forward));
        const right = cross(this.#forward, this.#up);
        const across = this.#wheels.map((wheel) => dot(wheel.attach, right));
        this.#wheelbase = Math.max(...along) - Math.min(...along);
        this.#track = Math.max(...across) - Math.min(...across);
    }
    get chassis() { return this.#chassis; }
    get state() {
        return {
            wheels: this.#wheels.map((wheel) => ({
                position: [...wheel.position], spin: wheel.spin, steeringAngle: wheel.steeringAngle, compression: wheel.compression,
                grounded: wheel.grounded, contactPoint: [...wheel.contactPoint], contactNormal: [...wheel.contactNormal],
                suspensionForce: wheel.suspensionForce, slipRatio: wheel.slipRatio, slipAngle: wheel.slipAngle, angularVelocity: wheel.omega,
            })),
            speed: this.#speed,
            grounded: this.#wheels.some((wheel) => wheel.grounded),
        };
    }
    /** Queues this step's suspension and tyre forces. Call once per fixed step
     * with the chassis snapshot from the previous step, before `world.step`. */
    update(dt, input, chassis) {
        positive(dt, 'Vehicle timestep');
        const throttle = clamp(finite(input.throttle, 'Vehicle throttle'), -1, 1);
        const steer = clamp(finite(input.steer, 'Vehicle steer'), -1, 1);
        const brake = clamp(finite(input.brake ?? 0, 'Vehicle brake'), 0, 1);
        const handbrake = input.handbrake ?? false;
        const q = chassis.rotation;
        const forward = rotate(q, this.#forward), up = rotate(q, this.#up);
        const down = [-up[0], -up[1], -up[2]];
        this.#speed = dot(chassis.linearVelocity, forward);
        this.#steer(steer * this.#lock);
        for (const wheel of this.#wheels) {
            const attach = add(chassis.position, rotate(q, wheel.attach));
            const reach = wheel.suspension.restLength + wheel.radius;
            const hit = this.#world.raycast(attach, down, reach, this.#filter);
            if (hit === undefined) {
                wheel.grounded = false;
                wheel.compression = 0;
                wheel.suspensionForce = 0;
                wheel.slipRatio = 0;
                wheel.slipAngle = 0;
                wheel.position = add(attach, scale(down, wheel.suspension.restLength));
                this.#spinFree(wheel, dt, throttle, brake, handbrake);
                continue;
            }
            wheel.grounded = true;
            wheel.contactPoint = [...hit.point];
            wheel.contactNormal = [...hit.normal];
            wheel.compression = clamp(wheel.suspension.restLength - (hit.distance - wheel.radius), 0, wheel.suspension.maxTravel);
            wheel.position = add(attach, scale(down, wheel.suspension.restLength - wheel.compression));
            const normal = wheel.contactNormal;
            const arm = subtract(wheel.contactPoint, chassis.position);
            const contactVelocity = add(chassis.linearVelocity, cross(chassis.angularVelocity, arm));
            // Damping follows the chassis velocity along the suspension contact
            // normal. A finite difference of ray compression injects an enormous
            // impulse on the first contact frame (0 -> full travel), launching the
            // chassis before its tyres can produce drive force.
            const compressionSpeed = -dot(contactVelocity, normal);
            const load = Math.max(0, wheel.suspension.stiffness * wheel.compression + wheel.suspension.damping * compressionSpeed);
            wheel.suspensionForce = load;
            this.#world.addForceAtPoint(this.#chassis, scale(normal, load), wheel.contactPoint);
            // Tyre frame on the contact plane.
            const steered = rotateAbout(forward, up, wheel.steeringAngle);
            const projectedForward = projectOnPlane(steered, normal);
            // A rolled chassis can point its nominal forward axis into the contact
            // normal. Keep the tire frame finite while the rigid-body solver rights
            // or settles the vehicle; zero vectors must never crash a physics step.
            const fallbackForward = cross(normal, rotate(q, cross(this.#up, this.#forward)));
            const longAxis = unitOr(projectedForward, fallbackForward, 'tyre forward');
            const latAxis = unitOr(cross(longAxis, normal), rotate(q, cross(this.#forward, this.#up)), 'tyre side');
            const vLong = dot(contactVelocity, longAxis), vLat = dot(contactVelocity, latAxis);
            const floor = Math.max(Math.abs(vLong), 1);
            wheel.slipRatio = (wheel.omega * wheel.radius - vLong) / floor;
            wheel.slipAngle = Math.atan2(vLat, floor);
            let fLong = this.#longitudinal * wheel.slipRatio * load;
            let fLat = -this.#lateral * wheel.slipAngle * load;
            // The road cannot spin the wheel past rolling within one step; without
            // this clamp the slip stiffness makes the wheel oscillate about it.
            const rollLimit = Math.abs(wheel.omega * wheel.radius - vLong) * this.#inertia / (wheel.radius * wheel.radius * dt);
            fLong = clamp(fLong, -rollLimit, rollLimit);
            const limit = wheel.friction * load, magnitude = Math.hypot(fLong, fLat);
            if (magnitude > limit && magnitude > 0) {
                fLong *= limit / magnitude;
                fLat *= limit / magnitude;
            }
            this.#world.addForceAtPoint(this.#chassis, add(scale(longAxis, fLong), scale(latAxis, fLat)), wheel.contactPoint);
            // Wheel spin: engine and brake torque against the road's reaction.
            const drive = wheel.driven ? throttle * this.#engine : 0;
            wheel.omega += (drive - fLong * wheel.radius) / this.#inertia * dt;
            this.#applyBrake(wheel, dt, brake, handbrake);
            wheel.spin += wheel.omega * dt;
        }
        return this.state;
    }
    #steer(angle) {
        for (const wheel of this.#wheels) {
            if (!wheel.steering) {
                wheel.steeringAngle = 0;
                continue;
            }
            if (!this.#ackermann || Math.abs(angle) < 1e-6 || this.#wheelbase < 1e-6) {
                wheel.steeringAngle = angle;
                continue;
            }
            // Turn centre lies on the rear axle; the inner wheel sees a tighter radius.
            const radius = this.#wheelbase / Math.tan(Math.abs(angle));
            const right = cross(this.#forward, this.#up);
            const side = dot(wheel.attach, right);
            const inner = angle > 0 ? side < 0 : side > 0;
            const wheelRadius = Math.max(0.01, radius + (inner ? -1 : 1) * this.#track / 2);
            wheel.steeringAngle = Math.sign(angle) * Math.atan(this.#wheelbase / wheelRadius);
        }
    }
    #spinFree(wheel, dt, throttle, brake, handbrake) {
        if (wheel.driven)
            wheel.omega += throttle * this.#engine / this.#inertia * dt;
        this.#applyBrake(wheel, dt, brake, handbrake);
        wheel.spin += wheel.omega * dt;
    }
    #applyBrake(wheel, dt, brake, handbrake) {
        const strength = Math.max(brake, handbrake && !wheel.steering ? 1 : 0);
        if (strength <= 0)
            return;
        const stop = Math.abs(wheel.omega) * this.#inertia / dt;
        const torque = Math.min(strength * this.#brake, stop);
        wheel.omega -= Math.sign(wheel.omega) * torque / this.#inertia * dt;
    }
}
function unit(value, label) {
    const length = Math.hypot(value[0], value[1], value[2]);
    if (!Number.isFinite(length) || length < 1e-9)
        throw new Error(`${label} cannot be a zero vector.`);
    return [value[0] / length, value[1] / length, value[2] / length];
}
function unitOr(value, fallback, label) {
    const length = Math.hypot(value[0], value[1], value[2]);
    if (Number.isFinite(length) && length >= 1e-9)
        return [value[0] / length, value[1] / length, value[2] / length];
    return unit(fallback, label);
}
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function projectOnPlane(v, n) { const d = dot(v, n); return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]; }
function rotate(q, v) {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
/** Rodrigues rotation of `v` about unit `axis`. */
function rotateAbout(v, axis, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), k = cross(axis, v), d = dot(axis, v);
    return [v[0] * c + k[0] * s + axis[0] * d * (1 - c), v[1] * c + k[1] * s + axis[1] * d * (1 - c), v[2] * c + k[2] * s + axis[2] * d * (1 - c)];
}
//# sourceMappingURL=vehicle-3d.js.map