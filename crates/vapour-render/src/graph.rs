use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap, HashSet},
};

use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ResourceId(u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PassId(u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceKind {
    Texture,
    Buffer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PassKind {
    Render,
    Compute,
    Copy,
}

#[derive(Debug, Clone)]
struct ResourceNode {
    name: String,
    kind: ResourceKind,
    imported: bool,
}

#[derive(Debug, Clone)]
pub struct RenderPassNode {
    pub id: PassId,
    pub name: String,
    pub kind: PassKind,
    pub reads: Vec<ResourceId>,
    pub writes: Vec<ResourceId>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GraphError {
    #[error("render graph has duplicate pass name '{0}'")]
    DuplicatePass(String),
    #[error("pass '{pass}' refers to unknown resource {resource:?}")]
    UnknownResource { pass: String, resource: ResourceId },
    #[error("pass '{pass}' reads uninitialized resource '{resource}'")]
    UninitializedRead { pass: String, resource: String },
    #[error("render graph dependency contains unknown pass {0:?}")]
    UnknownPass(PassId),
    #[error("render graph contains a dependency cycle involving: {0}")]
    Cycle(String),
    #[error("render graph executor failed in pass '{pass}': {message}")]
    Execution { pass: String, message: String },
}

#[derive(Default)]
pub struct RenderGraph {
    resources: Vec<ResourceNode>,
    passes: Vec<RenderPassNode>,
    dependencies: HashSet<(PassId, PassId)>,
}

impl RenderGraph {
    #[must_use]
    pub fn create_resource(&mut self, name: impl Into<String>, kind: ResourceKind) -> ResourceId {
        self.push_resource(name.into(), kind, false)
    }

    #[must_use]
    pub fn import_resource(&mut self, name: impl Into<String>, kind: ResourceKind) -> ResourceId {
        self.push_resource(name.into(), kind, true)
    }

    pub fn add_pass(
        &mut self,
        name: impl Into<String>,
        kind: PassKind,
        reads: impl IntoIterator<Item = ResourceId>,
        writes: impl IntoIterator<Item = ResourceId>,
    ) -> Result<PassId, GraphError> {
        let name = name.into();
        if self.passes.iter().any(|pass| pass.name == name) {
            return Err(GraphError::DuplicatePass(name));
        }
        let id =
            PassId(u32::try_from(self.passes.len()).expect("render pass count exceeds u32::MAX"));
        let pass = RenderPassNode {
            id,
            name,
            kind,
            reads: reads.into_iter().collect(),
            writes: writes.into_iter().collect(),
        };
        self.validate_resources(&pass)?;
        self.passes.push(pass);
        Ok(id)
    }

    pub fn order_before(&mut self, before: PassId, after: PassId) -> Result<(), GraphError> {
        if self.passes.get(before.0 as usize).is_none() {
            return Err(GraphError::UnknownPass(before));
        }
        if self.passes.get(after.0 as usize).is_none() {
            return Err(GraphError::UnknownPass(after));
        }
        self.dependencies.insert((before, after));
        Ok(())
    }

    pub fn compile(&self) -> Result<CompiledRenderGraph, GraphError> {
        let mut edges: HashSet<(PassId, PassId)> = self.dependencies.clone();
        let mut last_writer: HashMap<ResourceId, PassId> = HashMap::new();
        let mut readers_since_write: HashMap<ResourceId, Vec<PassId>> = HashMap::new();

        // Declaration order resolves otherwise ambiguous resource hazards. Explicit
        // dependencies may add stronger constraints and are cycle-checked below.
        for pass in &self.passes {
            for resource in &pass.reads {
                if let Some(writer) = last_writer.get(resource).copied()
                    && writer != pass.id
                {
                    edges.insert((writer, pass.id));
                }
                readers_since_write
                    .entry(*resource)
                    .or_default()
                    .push(pass.id);
            }
            for resource in &pass.writes {
                if let Some(writer) = last_writer.insert(*resource, pass.id)
                    && writer != pass.id
                {
                    edges.insert((writer, pass.id));
                }
                for reader in readers_since_write.remove(resource).unwrap_or_default() {
                    if reader != pass.id {
                        edges.insert((reader, pass.id));
                    }
                }
            }
        }

        let mut outgoing = vec![Vec::new(); self.passes.len()];
        let mut indegree = vec![0_u32; self.passes.len()];
        for (before, after) in edges {
            outgoing[before.0 as usize].push(after);
            indegree[after.0 as usize] += 1;
        }
        let mut ready = BinaryHeap::new();
        for (index, count) in indegree.iter().enumerate() {
            if *count == 0 {
                ready.push(Reverse(PassId(index as u32)));
            }
        }
        let mut order = Vec::with_capacity(self.passes.len());
        while let Some(Reverse(pass)) = ready.pop() {
            order.push(pass);
            for next in &outgoing[pass.0 as usize] {
                indegree[next.0 as usize] -= 1;
                if indegree[next.0 as usize] == 0 {
                    ready.push(Reverse(*next));
                }
            }
        }
        if order.len() != self.passes.len() {
            let cycle = indegree
                .iter()
                .enumerate()
                .filter(|(_, count)| **count > 0)
                .map(|(index, _)| self.passes[index].name.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(GraphError::Cycle(cycle));
        }

        let mut initialized: HashSet<_> = self
            .resources
            .iter()
            .enumerate()
            .filter_map(|(index, resource)| resource.imported.then_some(ResourceId(index as u32)))
            .collect();
        for pass_id in &order {
            let pass = &self.passes[pass_id.0 as usize];
            for resource in &pass.reads {
                if !initialized.contains(resource) && !pass.writes.contains(resource) {
                    return Err(GraphError::UninitializedRead {
                        pass: pass.name.clone(),
                        resource: self.resources[resource.0 as usize].name.clone(),
                    });
                }
            }
            initialized.extend(pass.writes.iter().copied());
        }
        Ok(CompiledRenderGraph {
            passes: order
                .into_iter()
                .map(|id| self.passes[id.0 as usize].clone())
                .collect(),
        })
    }

    fn push_resource(&mut self, name: String, kind: ResourceKind, imported: bool) -> ResourceId {
        let id = ResourceId(
            u32::try_from(self.resources.len()).expect("render resource count exceeds u32::MAX"),
        );
        self.resources.push(ResourceNode {
            name,
            kind,
            imported,
        });
        id
    }

    fn validate_resources(&self, pass: &RenderPassNode) -> Result<(), GraphError> {
        for resource in pass.reads.iter().chain(&pass.writes) {
            if self.resources.get(resource.0 as usize).is_none() {
                return Err(GraphError::UnknownResource {
                    pass: pass.name.clone(),
                    resource: *resource,
                });
            }
        }
        Ok(())
    }

    #[must_use]
    pub fn resource_kind(&self, resource: ResourceId) -> Option<ResourceKind> {
        self.resources
            .get(resource.0 as usize)
            .map(|node| node.kind)
    }
}

pub struct CompiledRenderGraph {
    passes: Vec<RenderPassNode>,
}

impl CompiledRenderGraph {
    #[must_use]
    pub fn passes(&self) -> &[RenderPassNode] {
        &self.passes
    }

    pub fn execute(&self, executor: &mut impl RenderGraphExecutor) -> Result<(), GraphError> {
        for pass in &self.passes {
            executor
                .execute(pass)
                .map_err(|message| GraphError::Execution {
                    pass: pass.name.clone(),
                    message,
                })?;
        }
        Ok(())
    }
}

pub trait RenderGraphExecutor {
    fn execute(&mut self, pass: &RenderPassNode) -> Result<(), String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_deferred_frame_and_executes_it() {
        let mut graph = RenderGraph::default();
        let depth = graph.create_resource("depth", ResourceKind::Texture);
        let gbuffer = graph.create_resource("gbuffer", ResourceKind::Texture);
        let swapchain = graph.import_resource("swapchain", ResourceKind::Texture);
        graph
            .add_pass("depth-prepass", PassKind::Render, [], [depth])
            .unwrap();
        graph
            .add_pass("gbuffer", PassKind::Render, [depth], [gbuffer])
            .unwrap();
        graph
            .add_pass("lighting", PassKind::Compute, [gbuffer], [swapchain])
            .unwrap();
        let compiled = graph.compile().unwrap();
        assert_eq!(
            compiled
                .passes()
                .iter()
                .map(|pass| pass.name.as_str())
                .collect::<Vec<_>>(),
            ["depth-prepass", "gbuffer", "lighting"]
        );
        struct Recorder(Vec<String>);
        impl RenderGraphExecutor for Recorder {
            fn execute(&mut self, pass: &RenderPassNode) -> Result<(), String> {
                self.0.push(pass.name.clone());
                Ok(())
            }
        }
        let mut recorder = Recorder(Vec::new());
        compiled.execute(&mut recorder).unwrap();
        assert_eq!(recorder.0, ["depth-prepass", "gbuffer", "lighting"]);
    }

    #[test]
    fn rejects_uninitialized_reads() {
        let mut graph = RenderGraph::default();
        let texture = graph.create_resource("never-written", ResourceKind::Texture);
        graph
            .add_pass("sample", PassKind::Render, [texture], [])
            .unwrap();
        assert!(matches!(
            graph.compile(),
            Err(GraphError::UninitializedRead { .. })
        ));
    }

    #[test]
    fn rejects_explicit_cycles() {
        let mut graph = RenderGraph::default();
        let a = graph.add_pass("a", PassKind::Compute, [], []).unwrap();
        let b = graph.add_pass("b", PassKind::Compute, [], []).unwrap();
        graph.order_before(a, b).unwrap();
        graph.order_before(b, a).unwrap();
        assert!(matches!(graph.compile(), Err(GraphError::Cycle(_))));
    }
}
